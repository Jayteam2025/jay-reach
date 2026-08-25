'use server';

import { requireRole, getUser } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { processImport, type ParsedRows, type ColumnMapping, type MappedRow } from '@jay-reach/core';

export type ImportRunResult =
  | { ok: true; imported: number; listId: string }
  | { ok: false; error: string };

export interface ImportInput {
  parsed: ParsedRows;
  mapping: ColumnMapping;
  fileName: string | null;
  destination: 'list' | 'existing' | 'campaign';
  listName: string;
  contextNote: string;
  existingListId?: string | null;
  campaignId?: string | null;
}

function domainOf(website: string | undefined): string | null {
  if (!website) return null;
  return website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase() || null;
}
const val = (r: MappedRow, k: keyof MappedRow): string | null => {
  const v = r[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Persiste un import : crée (ou réutilise) une liste, insère/dédoublonne les
 * comptes et contacts, remplit la liste, et — destination « campagne » — inscrit
 * les contacts. Écrit une ligne d'audit `imports`. Transactionnel. Rôle operator.
 */
export async function runImport(organizationId: string, input: ImportInput): Promise<ImportRunResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  if (!input.listName.trim() || !input.contextNote.trim()) {
    return { ok: false, error: 'Nom de liste et note de contexte obligatoires.' };
  }
  const user = await getUser();
  const outcome = processImport(input.parsed, input.mapping);
  if (outcome.rows.length === 0) {
    return { ok: false, error: 'Aucune ligne exploitable.' };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');

    // 1. Liste (nouvelle, ou existante vérifiée pour l'organisation).
    let listId: string;
    if (input.destination === 'existing' && input.existingListId) {
      const chk = await client.query<{ id: string }>('select id from lists where id = $1 and organization_id = $2', [
        input.existingListId,
        organizationId,
      ]);
      if (!chk.rows[0]) throw new Error('Liste introuvable.');
      listId = chk.rows[0].id;
    } else {
      const ins = await client.query<{ id: string }>(
        `insert into lists (organization_id, name, context_note, origin, source_file_name, imported_by)
         values ($1, $2, $3, 'import', $4, $5) returning id`,
        [organizationId, input.listName.trim(), input.contextNote.trim(), input.fileName, user?.id ?? null],
      );
      listId = ins.rows[0]!.id;
    }

    let imported = 0;
    for (const row of outcome.rows) {
      // 2. Compte (dédup SIREN → domaine → sinon création si nom présent).
      const company = val(row, 'company');
      const siren = val(row, 'siren');
      const domain = domainOf(val(row, 'website') ?? undefined);
      let accountId: string | null = null;
      if (siren) {
        const a = await client.query<{ id: string }>(
          `insert into accounts (organization_id, name, siren, city, postal_code, country, domain, resolution_status)
           values ($1, $2, $3, $4, $5, $6, $7, 'resolved')
           on conflict (organization_id, siren) where siren is not null
           do update set name = coalesce(accounts.name, excluded.name), domain = coalesce(accounts.domain, excluded.domain)
           returning id`,
          [organizationId, company ?? siren, siren, val(row, 'city'), val(row, 'postal_code'), val(row, 'country'), domain],
        );
        accountId = a.rows[0]?.id ?? null;
      } else if (domain) {
        const a = await client.query<{ id: string }>(
          `insert into accounts (organization_id, name, domain, city, postal_code, country, resolution_status)
           values ($1, $2, $3, $4, $5, $6, 'resolved')
           on conflict (organization_id, domain) where domain is not null
           do update set name = coalesce(accounts.name, excluded.name)
           returning id`,
          [organizationId, company ?? domain, domain, val(row, 'city'), val(row, 'postal_code'), val(row, 'country')],
        );
        accountId = a.rows[0]?.id ?? null;
      } else if (company) {
        const a = await client.query<{ id: string }>(
          `insert into accounts (organization_id, name, resolution_status) values ($1, $2, 'unresolved') returning id`,
          [organizationId, company],
        );
        accountId = a.rows[0]?.id ?? null;
      }

      // 3. Contact (dédup par email si présent, sinon insertion simple).
      const email = val(row, 'email');
      let contactId: string;
      if (email) {
        const c = await client.query<{ id: string }>(
          `insert into contacts (organization_id, first_name, last_name, email, job_title, linkedin_url, account_id, source_list_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (organization_id, lower(email)) where email is not null
           do update set
             first_name = coalesce(contacts.first_name, excluded.first_name),
             last_name = coalesce(contacts.last_name, excluded.last_name),
             job_title = coalesce(contacts.job_title, excluded.job_title),
             linkedin_url = coalesce(contacts.linkedin_url, excluded.linkedin_url),
             account_id = coalesce(contacts.account_id, excluded.account_id),
             source_list_id = coalesce(contacts.source_list_id, excluded.source_list_id)
           returning id`,
          [organizationId, val(row, 'first_name'), val(row, 'last_name'), email, val(row, 'job_title'), val(row, 'linkedin_url'), accountId, listId],
        );
        contactId = c.rows[0]!.id;
      } else {
        const c = await client.query<{ id: string }>(
          `insert into contacts (organization_id, first_name, last_name, job_title, linkedin_url, account_id, source_list_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [organizationId, val(row, 'first_name'), val(row, 'last_name'), val(row, 'job_title'), val(row, 'linkedin_url'), accountId, listId],
        );
        contactId = c.rows[0]!.id;
      }

      // 4. Appartenance à la liste.
      await client.query(
        `insert into list_members (list_id, contact_id, raw_row) values ($1, $2, $3::jsonb)
         on conflict (list_id, contact_id) do nothing`,
        [listId, contactId, JSON.stringify(row.raw)],
      );

      // 5. Destination campagne : inscription (une seule active par contact).
      if (input.destination === 'campaign' && input.campaignId) {
        await client.query(
          `insert into enrollments (organization_id, campaign_id, contact_id, list_id, status, current_step, next_action_at, started_at)
           values ($1, $2, $3, $4, 'active', 0, now(), now())
           on conflict (contact_id) where status in ('active','paused','paused_absence') do nothing`,
          [organizationId, input.campaignId, contactId, listId],
        );
      }
      imported += 1;
    }

    // 6. Audit.
    await client.query(
      `insert into imports (organization_id, file_name, rows_total, rows_unique, rows_merged, mapping, status, list_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, 'done', $7)`,
      [
        organizationId,
        input.fileName ?? 'import.csv',
        outcome.report.rowsTotal,
        outcome.report.rowsUnique,
        outcome.report.rowsMerged,
        JSON.stringify(input.mapping),
        listId,
      ],
    );

    await client.query('commit');
    return { ok: true, imported, listId };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur import.' };
  } finally {
    client.release();
  }
}

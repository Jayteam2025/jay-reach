'use server';

import { requireRole } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { processImport, type ParsedRows, type ColumnMapping } from '@jay-reach/core';

export type CustomerImportResult = { ok: true; count: number; excluded: number } | { ok: false; error: string };

function normDomain(website: string | undefined): string | null {
  if (!website) return null;
  return (
    website
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase() || null
  );
}

/**
 * Importe une liste de clients actuels (exclusion au niveau du compte). Insère
 * les entrées, PUIS marque les comptes existants correspondants comme clients
 * (SIREN → domaine → nom normalisé) : le trigger `enforce_customer_exclusion`
 * crée alors les suppressions de portée compte. Les futures résolutions sont
 * filtrées par `match_customer_account`. Rôle admin. Transactionnel.
 */
export async function importCustomers(
  organizationId: string,
  input: { parsed: ParsedRows; mapping: ColumnMapping; listName: string },
): Promise<CustomerImportResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!input.listName.trim()) return { ok: false, error: 'Nom de liste obligatoire.' };

  const rows = processImport(input.parsed, input.mapping).rows;
  const entries = rows
    .map((r) => {
      const name = typeof r.company === 'string' ? r.company.trim() : '';
      const siren = typeof r.siren === 'string' ? r.siren.replace(/\s/g, '') : '';
      const domain = normDomain(typeof r.website === 'string' ? r.website : undefined);
      if (!name && !siren && !domain) return null;
      return { siren: siren || null, domain, nameNorm: name ? name.toLowerCase() : null, rawName: name || null };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (entries.length === 0) return { ok: false, error: 'Aucune entreprise exploitable.' };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const list = await client.query<{ id: string }>(
      `insert into customer_lists (organization_id, name, source) values ($1, $2, 'csv') returning id`,
      [organizationId, input.listName.trim()],
    );
    const listId = list.rows[0]!.id;

    for (const e of entries) {
      await client.query(
        `insert into customer_list_entries (customer_list_id, organization_id, siren, domain, name_normalized, raw_name)
         values ($1, $2, $3, $4, $5, $6)`,
        [listId, organizationId, e.siren, e.domain, e.nameNorm, e.rawName],
      );
    }
    await client.query(`update customer_lists set entries_count = $2 where id = $1`, [listId, entries.length]);

    // Marque les comptes EXISTANTS correspondants → le trigger crée les suppressions.
    const upd = await client.query(
      `update accounts a set is_customer = true
       from customer_list_entries e
       where e.customer_list_id = $1
         and a.organization_id = $2
         and a.is_customer is distinct from true
         and (
           (e.siren is not null and a.siren = e.siren)
           or (e.domain is not null and a.domain = e.domain)
           or (e.name_normalized is not null and lower(a.name) = e.name_normalized)
         )`,
      [listId, organizationId],
    );

    await client.query('commit');
    return { ok: true, count: entries.length, excluded: upd.rowCount ?? 0 };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur import clients.' };
  } finally {
    client.release();
  }
}

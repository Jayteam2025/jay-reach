/**
 * Accès base du worker (pg direct, côté serveur/service — filtrage explicite
 * par organisation dans chaque requête). Écriture de la résolution d'entreprise.
 */
import { Pool } from 'pg';
import type { ScrapedSignal } from '@jay-reach/providers/signals';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Déchiffre le secret d'un provider via le coffre (`app.get_credential`,
 * pgcrypto). La clé de chiffrement vit hors base — passée ici depuis
 * l'environnement du worker. Le secret déchiffré ne transite jamais par
 * PostgREST : seul le worker (connexion pg directe, service) y accède.
 */
export async function getCredentialSecret(
  pool: Pool,
  organizationId: string,
  providerId: string,
  encryptionKey: string,
): Promise<string | null> {
  const res = await pool.query<{ secret: string | null }>('select app.get_credential($1, $2, $3) as secret', [
    organizationId,
    providerId,
    encryptionKey,
  ]);
  return res.rows[0]?.secret ?? null;
}

/** Champs non-secrets d'un provider (jsonb `config`), ou null si non configuré. */
export async function getCredentialConfig(
  pool: Pool,
  organizationId: string,
  providerId: string,
): Promise<Record<string, string> | null> {
  const res = await pool.query<{ config: Record<string, string> | null }>(
    'select config from credentials where organization_id = $1 and provider_id = $2',
    [organizationId, providerId],
  );
  return res.rows[0]?.config ?? null;
}

export interface InsertedSignal {
  readonly signalId: string;
  readonly organizationId: string;
  readonly companyName: string | null;
}

/**
 * Écrit les signaux détectés (déduplication par (source, url) via l'index
 * unique). Ne garde que les `job_posting`. Retourne les NOUVEAUX signaux
 * (ceux réellement insérés) pour permettre le chaînage vers la qualification.
 */
export async function insertSignals(
  pool: Pool,
  organizationId: string,
  sourceId: string,
  providerId: string,
  signals: readonly ScrapedSignal[],
): Promise<InsertedSignal[]> {
  const inserted: InsertedSignal[] = [];
  for (const signal of signals) {
    if (signal.signal_type !== 'job_posting') {
      continue;
    }
    const data = signal.extracted_data;
    const companyName = (data.company_name as string | null | undefined) ?? null;
    const res = await pool.query<{ id: string }>(
      `insert into signals
         (organization_id, source_id, provider_id, external_id, kind, occurred_at,
          raw, title, url, company_hint, location, status)
       values ($1, $2, $3, $4, 'job_posting', coalesce($5::timestamptz, now()),
          $6::jsonb, $7, $8, $9, $10, 'new')
       on conflict (source_id, external_id) do nothing
       returning id`,
      [
        organizationId,
        sourceId,
        providerId,
        signal.source_url,
        (data.posted_date as string | null | undefined) ?? null,
        JSON.stringify(data),
        (data.job_title as string | null | undefined) ?? null,
        signal.source_url,
        companyName,
        (data.location as string | null | undefined) ?? null,
      ],
    );
    const id = res.rows[0]?.id;
    if (id) {
      inserted.push({ signalId: id, organizationId, companyName });
    }
  }
  return inserted;
}

/** Ouvre un enregistrement d'exécution de source (`source_runs`, statut `running`). */
export async function startSourceRun(pool: Pool, sourceId: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into source_runs (source_id, status) values ($1, 'running') returning id`,
    [sourceId],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error('source_runs: insertion sans id');
  }
  return id;
}

export interface SourceRunResult {
  readonly found: number;
  readonly added: number;
  readonly status: 'success' | 'error';
  readonly error?: string | null;
}

/** Clôt un enregistrement d'exécution de source (compteurs + statut final). */
export async function finishSourceRun(pool: Pool, runId: string, result: SourceRunResult): Promise<void> {
  await pool.query(
    `update source_runs
        set finished_at = now(), status = $2, items_found = $3, items_new = $4, error = $5
      where id = $1`,
    [runId, result.status, result.found, result.added, result.error ?? null],
  );
}

export interface LinkedInActionJob {
  readonly organizationId: string;
  readonly kind: 'invite' | 'message';
  readonly linkedinUrl: string;
  readonly contactId?: string | null;
  readonly signalId?: string | null;
  readonly messageBody?: string | null;
  readonly method?: 'extension_auto' | 'manual';
}

/**
 * Enfile une action LinkedIn (invitation ou message) dans
 * `linkedin_action_queue`, consommée par l'extension Chrome (envoi via Voyager,
 * session de l'utilisateur ; pacing appliqué côté serveur). Dédup : pas de
 * doublon actif (pending/processing/sent) pour le même (contact, kind).
 * Retourne l'id créé, ou null si déjà en file. Aucun envoi ici.
 */
export async function enqueueLinkedInAction(pool: Pool, job: LinkedInActionJob): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `insert into linkedin_action_queue
       (organization_id, contact_id, signal_id, linkedin_url, kind, message_body, method)
     select $1, $2, $3, $4, $5, $6, $7
     where not exists (
       select 1 from linkedin_action_queue q
       where q.contact_id = $2 and q.kind = $5
         and q.status in ('pending', 'processing', 'sent')
         and $2 is not null
     )
     returning id`,
    [
      job.organizationId,
      job.contactId ?? null,
      job.signalId ?? null,
      job.linkedinUrl,
      job.kind,
      job.messageBody ?? null,
      job.method ?? 'extension_auto',
    ],
  );
  return res.rows[0]?.id ?? null;
}

export interface ResolvedAccount {
  readonly organizationId: string;
  readonly name: string;
  readonly siren: string | null;
  readonly nafCode: string | null;
  /** Rapprochement fiable ? (sinon on ne pose pas la firmographie — cf. legacy). */
  readonly trusted: boolean;
}

/**
 * Enregistre le compte résolu. Sur un rapprochement fiable : SIREN + NAF et
 * statut `resolved`. Sinon : compte `unresolved` (file d'arbitrage humain).
 */
export async function upsertResolvedAccount(pool: Pool, acc: ResolvedAccount): Promise<string | null> {
  if (acc.trusted && acc.siren) {
    const res = await pool.query<{ id: string }>(
      `insert into accounts (organization_id, name, siren, naf_code, resolution_status)
       values ($1, $2, $3, $4, 'resolved')
       on conflict (organization_id, siren) where siren is not null
       do update set naf_code = excluded.naf_code, name = excluded.name
       returning id`,
      [acc.organizationId, acc.name, acc.siren, acc.nafCode],
    );
    return res.rows[0]?.id ?? null;
  }
  const res = await pool.query<{ id: string }>(
    `insert into accounts (organization_id, name, resolution_status)
     values ($1, $2, 'unresolved')
     returning id`,
    [acc.organizationId, acc.name],
  );
  return res.rows[0]?.id ?? null;
}

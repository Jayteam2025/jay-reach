/**
 * Accès à la file d'actions LinkedIn (`linkedin_action_queue`) via `pg`.
 * Consommé par les route handlers de l'extension (`/api/extension/linkedin/*`)
 * et, en Phase 4, par le séquenceur pour enfiler. Le pacing pur vient de
 * `@jay-reach/core` (`decideCanSend`) ; ici on ne fait que les I/O SQL.
 *
 * Aucun envoi réel : ce module prépare/claim/enregistre des lignes de file.
 * L'envoi Voyager est fait par l'extension, avec la session de l'utilisateur.
 */
import type { Pool, PoolClient } from 'pg';
import {
  decideCanSend,
  parisHour,
  PROCESSING_TIMEOUT_MIN,
  HARD_CAP_7_DAYS,
  type PaceReason,
} from '@jay-reach/core';

export type LinkedInKind = 'invite' | 'message';
export type ActionStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface EnqueueInput {
  readonly organizationId: string;
  readonly linkedinUrl: string;
  readonly kind: LinkedInKind;
  readonly contactId?: string | null;
  readonly signalId?: string | null;
  readonly messageBody?: string | null;
  readonly method?: 'extension_auto' | 'manual';
}

export interface ClaimedAction {
  readonly id: string;
  readonly kind: LinkedInKind;
  readonly linkedinUrl: string;
  readonly messageBody: string | null;
}

export type ClaimResult =
  | { readonly action: ClaimedAction; readonly reason: null }
  | { readonly action: null; readonly reason: PaceReason | 'manual_mode' | 'daily_cap_reached' | 'queue_empty' | 'race_retry' };

/** Valide un jeton d'extension → organization_id (ou null si inconnu/désactivé). */
export async function validateToken(pool: Pool, token: string): Promise<string | null> {
  const r = await pool.query<{ org: string | null }>(
    'select app.validate_extension_token($1) as org',
    [token],
  );
  return r.rows[0]?.org ?? null;
}

/**
 * Enfile une action, en dédupliquant : pas de doublon actif (pending/processing/
 * sent) pour le même (contact, kind). Renvoie l'id créé, ou null si déjà en file.
 */
export async function enqueueAction(pool: Pool, input: EnqueueInput): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
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
      input.organizationId,
      input.contactId ?? null,
      input.signalId ?? null,
      input.linkedinUrl,
      input.kind,
      input.messageBody ?? null,
      input.method ?? 'extension_auto',
    ],
  );
  return r.rows[0]?.id ?? null;
}

interface PaceStats {
  readonly mode: 'auto' | 'hybrid' | 'manual';
  readonly dailyCap: number;
  readonly sentLast7Days: number;
  readonly sentToday: number;
  readonly lastSentAtIso: string | null;
}

async function loadPaceStats(client: PoolClient, orgId: string, now: Date): Promise<PaceStats> {
  const settings = await client.query<{ mode: 'auto' | 'hybrid' | 'manual'; daily_cap: number }>(
    'select mode, daily_cap from linkedin_settings where organization_id = $1',
    [orgId],
  );
  const nowIso = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const counts = await client.query<{ last7: string; today: string }>(
    `select
       count(*) filter (where sent_at >= $2) as last7,
       count(*) filter (where sent_at >= $3) as today
     from linkedin_action_queue
     where organization_id = $1 and status = 'sent'`,
    [orgId, sevenDaysAgo, oneDayAgo],
  );
  const last = await client.query<{ sent_at: string }>(
    `select sent_at from linkedin_action_queue
     where organization_id = $1 and status = 'sent'
     order by sent_at desc limit 1`,
    [orgId],
  );
  void nowIso;
  return {
    mode: settings.rows[0]?.mode ?? 'auto',
    dailyCap: settings.rows[0]?.daily_cap ?? 25,
    sentLast7Days: Number(counts.rows[0]?.last7 ?? 0),
    sentToday: Number(counts.rows[0]?.today ?? 0),
    lastSentAtIso: last.rows[0]?.sent_at ?? null,
  };
}

/**
 * Récupère et « claim » la prochaine action à envoyer pour une org, en
 * appliquant le pacing (fenêtre horaire, plafond 7 j, plafond quotidien du
 * curseur, intervalle). Requeue d'abord les lignes bloquées en `processing`.
 * Le claim pending→processing est atomique (anti double-envoi).
 *
 * `now` est injectable pour les tests hermétiques.
 */
export async function claimNext(pool: Pool, orgId: string, now: Date = new Date()): Promise<ClaimResult> {
  const client = await pool.connect();
  try {
    // 1. Requeue des lignes coincées en processing (extension morte en plein call).
    const stuckCutoff = new Date(now.getTime() - PROCESSING_TIMEOUT_MIN * 60_000).toISOString();
    await client.query(
      `update linkedin_action_queue
         set status = 'pending', processing_started_at = null, updated_at = now()
       where organization_id = $1 and status = 'processing' and processing_started_at < $2`,
      [orgId, stuckCutoff],
    );

    const stats = await loadPaceStats(client, orgId, now);

    // 2. Mode manuel → l'extension n'envoie rien d'elle-même.
    if (stats.mode === 'manual') {
      return { action: null, reason: 'manual_mode' };
    }

    // 3. Pacing pur : fenêtre + plafond 7 j (dur) + intervalle.
    const minutesSinceLastSent = stats.lastSentAtIso
      ? (now.getTime() - new Date(stats.lastSentAtIso).getTime()) / 60_000
      : null;
    const decision = decideCanSend({
      hour: parisHour(now),
      sentLast7Days: stats.sentLast7Days,
      cap7Days: HARD_CAP_7_DAYS,
      lastSentAtIso: stats.lastSentAtIso,
      minutesSinceLastSent,
    });
    if (!decision.ok) {
      return { action: null, reason: decision.reason };
    }

    // 4. Plafond quotidien du curseur (volume/jour choisi par l'org).
    if (stats.sentToday >= stats.dailyCap) {
      return { action: null, reason: 'daily_cap_reached' };
    }

    // 5. Prochaine ligne pending (la plus ancienne planifiée), claim atomique.
    const candidate = await client.query<{ id: string }>(
      `select id from linkedin_action_queue
       where organization_id = $1 and status = 'pending'
         and method = 'extension_auto' and scheduled_for <= $2
       order by scheduled_for asc limit 1`,
      [orgId, now.toISOString()],
    );
    const id = candidate.rows[0]?.id;
    if (!id) {
      return { action: null, reason: 'queue_empty' };
    }

    const claimed = await client.query<ClaimedAction & { message_body: string | null }>(
      `update linkedin_action_queue
         set status = 'processing', processing_started_at = $2,
             attempts = attempts + 1, updated_at = now()
       where id = $1 and status = 'pending'
       returning id, kind, linkedin_url as "linkedinUrl", message_body as "messageBody"`,
      [id, now.toISOString()],
    );
    const row = claimed.rows[0];
    if (!row) {
      return { action: null, reason: 'race_retry' };
    }
    return {
      action: { id: row.id, kind: row.kind, linkedinUrl: row.linkedinUrl, messageBody: row.messageBody },
      reason: null,
    };
  } finally {
    client.release();
  }
}

export interface RecordInput {
  readonly organizationId: string;
  readonly queueId: string;
  readonly status: 'sent' | 'failed';
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly now?: Date;
}

/**
 * Enregistre le résultat d'une action (renvoyé par l'extension). Transition
 * autorisée uniquement depuis `processing` (sinon 0 ligne → l'appelant renvoie 409).
 * Renvoie true si la transition a eu lieu.
 */
export async function recordResult(pool: Pool, input: RecordInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const sentAt = input.status === 'sent' ? now.toISOString() : null;
  const r = await pool.query(
    `update linkedin_action_queue
       set status = $3, sent_at = $4, error_code = $5, error_message = $6, updated_at = now()
     where id = $1 and organization_id = $2 and status = 'processing'`,
    [
      input.queueId,
      input.organizationId,
      input.status,
      sentAt,
      input.errorCode ?? null,
      input.errorMessage ?? null,
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

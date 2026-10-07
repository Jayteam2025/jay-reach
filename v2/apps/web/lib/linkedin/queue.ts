/**
 * Accès à la file d'actions LinkedIn (`linkedin_action_queue`) via `pg`.
 * Consommé par les route handlers de l'extension (`/api/extension/linkedin/*`)
 * et, en Phase 4, par le séquenceur pour enfiler. Le pacing pur vient de
 * `@jay-reach/core` (`decideCanSend`) ; ici on ne fait que les I/O SQL.
 *
 * Aucun envoi réel : ce module prépare/claim/enregistre des lignes de file.
 * L'envoi Voyager est fait par l'extension, avec la session de l'utilisateur.
 *
 * ATTENTION : le cœur porte la même logique de réclamation dans
 * `packages/core/src/linkedin/file.ts`. La duplication est délibérée (l'ancien
 * chemin cherche `method = 'extension_auto'`, le nouveau `'serveur'`) : toute
 * correction de la clause de réclamation se porte des DEUX côtés.
 */
import type { Pool, PoolClient } from 'pg';
import {
  decideCanSend,
  enregistrerResultat,
  type EntreeResultat,
  heureLocale,
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
  readonly weeklyCap: number;
  readonly startHour: number;
  readonly endHour: number;
  readonly days: number[];
  readonly timezone: string;
  readonly sentLast7Days: number;
  readonly sentToday: number;
  readonly lastSentAtIso: string | null;
}

async function loadPaceStats(client: PoolClient, orgId: string, now: Date): Promise<PaceStats> {
  // L'écran enregistre `weekly_cap`, les jours, la plage horaire et le fuseau
  // depuis toujours ; rien ici ne les lisait. Le pacing appliquait une fenêtre
  // 8 h - 21 h Paris codée en dur, tous les jours, et le plafond dur de 200 par
  // semaine quel que soit le curseur.
  const settings = await client.query<{
    mode: 'auto' | 'hybrid' | 'manual';
    weekly_cap: number | null;
    send_days: number[] | null;
    send_from_hour: number | null;
    send_to_hour: number | null;
    timezone: string | null;
  }>(
    `select mode, weekly_cap, send_days, send_from_hour, send_to_hour, timezone
       from linkedin_settings where organization_id = $1`,
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
  const r = settings.rows[0];
  const jours = (r?.send_days ?? []).filter((j) => j >= 1 && j <= 7);
  const hebdo = r?.weekly_cap ?? 100;

  // Le plafond quotidien se DÉDUIT du curseur hebdomadaire, et `daily_cap` est
  // volontairement ignoré.
  //
  // L'écran ne saisit plus que le volume par semaine ; `daily_cap` est une
  // colonne héritée que plus personne n'écrit. Sur la base, elle vaut encore 25
  // alors que le curseur dit 100 par semaine sur cinq jours — soit vingt. S'y
  // fier ferait envoyer cent vingt-cinq invitations en affichant cent : le
  // réglage visible mentirait sur ce qui part, ce qui est pire que pas de
  // réglage du tout.
  const quotidien = Math.max(1, Math.ceil(hebdo / Math.max(1, jours.length || 5)));

  return {
    mode: r?.mode ?? 'auto',
    dailyCap: quotidien,
    weeklyCap: hebdo,
    startHour: r?.send_from_hour ?? 8,
    endHour: r?.send_to_hour ?? 21,
    days: jours.length > 0 ? jours : [1, 2, 3, 4, 5],
    timezone: r?.timezone ?? 'Europe/Paris',
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
 * F14 (symétrique du garde-fou email, `sequence.ts`/`traitements.ts`) : la
 * réclamation (étape 5) ignore une ligne dont la campagne n'est pas active —
 * une invitation ou un message déjà enfilé avant une mise en pause ou un
 * archivage repartait sinon quand même, dès que l'extension revenait
 * l'exécuter. La ligne reste `pending`, jamais annulée : relancer la
 * campagne (`lancer`, `fonctions/campagnes.ts`) suffit à la rendre de nouveau
 * réclamable, sans qu'aucune inscription n'ait besoin d'être retouchée — même
 * logique que côté email. `q.action_id is null` couvre les lignes qui ne
 * viennent pas du séquenceur (jamais rattachées à une campagne, donc jamais
 * concernées par ce garde-fou) — en pratique aucune aujourd'hui (seul
 * `enqueueLinkedInAction`, toujours avec `actionId`, alimente la file), mais
 * la colonne elle-même est nullable (`references actions(id) on delete set
 * null`), donc pas de garantie NOT NULL à s'appuyer dessus.
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
    const { hour, isoDay } = heureLocale(now, stats.timezone);
    const decision = decideCanSend({
      hour,
      isoDay,
      startHour: stats.startHour,
      endHour: stats.endHour,
      days: stats.days,
      sentLast7Days: stats.sentLast7Days,
      // Le curseur de l'opérateur, sans jamais dépasser le plafond dur : c'est
      // lui qui protège le compte LinkedIn, pas le réglage.
      cap7Days: Math.min(stats.weeklyCap, HARD_CAP_7_DAYS),
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
      `select q.id
         from linkedin_action_queue q
         left join actions a on a.id = q.action_id
         left join enrollments e on e.id = a.enrollment_id
         left join campaigns camp on camp.id = e.campaign_id
        where q.organization_id = $1 and q.status = 'pending'
          and q.method = 'extension_auto' and q.scheduled_for <= $2
          and (q.action_id is null or camp.status = 'active')
        order by q.scheduled_for asc limit 1`,
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

/**
 * Enregistrement du résultat : l'implémentation vit dans le cœur
 * (`enregistrerResultat`, `@jay-reach/core`) pour que le worker l'importe ;
 * le nom et la forme d'entrée historiques restent pour les routes gelées.
 */
export type RecordInput = EntreeResultat;
export const recordResult = enregistrerResultat;

/**
 * File d'actions LinkedIn (`linkedin_action_queue`) : réclamation de la prochaine
 * action sous rythme, et enregistrement de son résultat. Portage depuis
 * `apps/web/lib/linkedin/queue.ts` pour que le worker puisse l'importer ; le
 * rythme pur vient de `pacing.ts`, ici on ne fait que les I/O SQL.
 *
 * Écarts assumés avec l'original : le candidat se filtre sur `q.method =
 * 'serveur'` (envoi par le serveur, plus par l'extension), et la réclamation
 * commence par refuser tant que `linkedin_server_sessions.envoi_pause_jusqua`
 * n'est pas passée.
 */
import type { Executeur } from '../executeur.js';
import { poserEcheanceApresDepart } from '../sequencer/echeance.js';
import {
  decideCanSend,
  heureLocale,
  PROCESSING_TIMEOUT_MIN,
  HARD_CAP_7_DAYS,
  type PaceReason,
} from './pacing.js';

export interface ActionReclamee {
  readonly id: string;
  readonly kind: 'invite' | 'message';
  readonly linkedinUrl: string;
  readonly messageBody: string | null;
}

export type MotifRefus =
  | PaceReason
  | 'manual_mode'
  | 'daily_cap_reached'
  | 'queue_empty'
  | 'race_retry'
  | 'canal_en_pause';

export type ResultatReclamation =
  | { readonly action: ActionReclamee; readonly motif: null }
  | { readonly action: null; readonly motif: MotifRefus };

interface StatsRythme {
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

async function chargerStatsRythme(ex: Executeur, orgId: string, now: Date): Promise<StatsRythme> {
  // L'écran enregistre `weekly_cap`, les jours, la plage horaire et le fuseau
  // depuis toujours ; rien ici ne les lisait. Le pacing appliquait une fenêtre
  // 8 h - 21 h Paris codée en dur, tous les jours, et le plafond dur de 200 par
  // semaine quel que soit le curseur.
  const settings = await ex.query<{
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
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const counts = await ex.query<{ last7: string; today: string }>(
    `select
       count(*) filter (where sent_at >= $2) as last7,
       count(*) filter (where sent_at >= $3) as today
     from linkedin_action_queue
     where organization_id = $1 and status = 'sent'`,
    [orgId, sevenDaysAgo, oneDayAgo],
  );
  const last = await ex.query<{ sent_at: string }>(
    `select sent_at from linkedin_action_queue
     where organization_id = $1 and status = 'sent'
     order by sent_at desc limit 1`,
    [orgId],
  );
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
 * Met l'envoi en pause jusqu'à `jusqua` : la réclamation refuse `canal_en_pause`
 * tant que cette date n'est pas passée. Sans ligne de session, rien n'est écrit.
 */
export async function mettreEnPauseEnvoiLinkedIn(ex: Executeur, organisationId: string, jusqua: Date): Promise<void> {
  await ex.query(
    `update linkedin_server_sessions set envoi_pause_jusqua = $2 where organization_id = $1`,
    [organisationId, jusqua.toISOString()],
  );
}

/**
 * Réclame la prochaine action à envoyer pour une organisation, en appliquant le
 * rythme (fenêtre horaire, plafond 7 j, plafond quotidien du curseur,
 * intervalle). Remet d'abord en file les lignes bloquées en `processing`. La
 * réclamation pending→processing est atomique (anti double envoi).
 *
 * F14 : la réclamation ignore une ligne dont la campagne n'est pas active — une
 * action déjà enfilée avant une mise en pause ou un archivage repartait sinon
 * quand même. La ligne reste `pending`, jamais annulée : relancer la campagne
 * suffit à la rendre de nouveau réclamable. `q.action_id is null` couvre les
 * lignes qui ne viennent pas du séquenceur (jamais rattachées à une campagne) ;
 * la colonne est nullable (`references actions(id) on delete set null`), donc
 * aucune garantie NOT NULL sur laquelle s'appuyer.
 *
 * `maintenant` est injectable pour les tests hermétiques.
 */
export async function reclamerProchaineAction(
  ex: Executeur,
  organisationId: string,
  maintenant: Date = new Date(),
): Promise<ResultatReclamation> {
  const orgId = organisationId;
  const now = maintenant;

  // 0. Pause d'envoi posée sur la session du serveur.
  const pause = await ex.query<{ envoi_pause_jusqua: string | Date | null }>(
    `select envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1`,
    [orgId],
  );
  const echeancePause = pause.rows[0]?.envoi_pause_jusqua;
  if (echeancePause && new Date(echeancePause).getTime() > now.getTime()) {
    return { action: null, motif: 'canal_en_pause' };
  }

  // 1. Requeue des lignes coincées en processing (appelant mort en plein call).
  const stuckCutoff = new Date(now.getTime() - PROCESSING_TIMEOUT_MIN * 60_000).toISOString();
  await ex.query(
    `update linkedin_action_queue
         set status = 'pending', processing_started_at = null, updated_at = now()
       where organization_id = $1 and status = 'processing' and processing_started_at < $2`,
    [orgId, stuckCutoff],
  );

  const stats = await chargerStatsRythme(ex, orgId, now);

  // 2. Mode manuel : rien ne part de soi-même.
  if (stats.mode === 'manual') {
    return { action: null, motif: 'manual_mode' };
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
    return { action: null, motif: decision.reason };
  }

  // 4. Plafond quotidien du curseur (volume/jour choisi par l'org).
  if (stats.sentToday >= stats.dailyCap) {
    return { action: null, motif: 'daily_cap_reached' };
  }

  // 5. Prochaine ligne pending (la plus ancienne planifiée), claim atomique.
  const candidate = await ex.query<{ id: string }>(
    `select q.id
         from linkedin_action_queue q
         left join actions a on a.id = q.action_id
         left join enrollments e on e.id = a.enrollment_id
         left join campaigns camp on camp.id = e.campaign_id
        where q.organization_id = $1 and q.status = 'pending'
          and q.method = 'serveur' and q.scheduled_for <= $2
          and (q.action_id is null or camp.status = 'active')
        order by q.scheduled_for asc limit 1`,
    [orgId, now.toISOString()],
  );
  const id = candidate.rows[0]?.id;
  if (!id) {
    return { action: null, motif: 'queue_empty' };
  }

  const claimed = await ex.query<ActionReclamee>(
    `update linkedin_action_queue
         set status = 'processing', processing_started_at = $2,
             attempts = attempts + 1, updated_at = now()
       where id = $1 and status = 'pending'
       returning id, kind, linkedin_url as "linkedinUrl", message_body as "messageBody"`,
    [id, now.toISOString()],
  );
  const row = claimed.rows[0];
  if (!row) {
    return { action: null, motif: 'race_retry' };
  }
  return {
    action: { id: row.id, kind: row.kind, linkedinUrl: row.linkedinUrl, messageBody: row.messageBody },
    motif: null,
  };
}

export interface EntreeResultat {
  readonly organizationId: string;
  readonly queueId: string;
  readonly status: 'sent' | 'failed';
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly now?: Date;
}

/**
 * Pose l'échéance de l'étape suivante au DÉPART RÉEL de l'action LinkedIn
 * (transition `processing -> sent`) — même point, même calcul et même garde que
 * côté SalesBlink (issue #111) : les deux transports appellent la même
 * implémentation partagée, `poserEcheanceApresDepart`. Ici, seule la résolution
 * propre à LinkedIn : retrouver l'inscription (`campaign_id`, `current_step`) à
 * partir de l'`actionId` posé sur la ligne de file.
 */
async function poserEcheanceApresDepartDepuisAction(ex: Executeur, actionId: string, now: Date): Promise<void> {
  const inscription = await ex.query<{ enrollment_id: string; campaign_id: string; current_step: number }>(
    `select en.id as enrollment_id, en.campaign_id, en.current_step
       from actions a
       join enrollments en on en.id = a.enrollment_id
      where a.id = $1`,
    [actionId],
  );
  const ligne = inscription.rows[0];
  if (!ligne) return;
  await poserEcheanceApresDepart(
    ex,
    { enrollmentId: ligne.enrollment_id, campaignId: ligne.campaign_id, currentStep: ligne.current_step },
    now,
  );
}

/**
 * Enregistre le résultat d'une action. Transition autorisée uniquement depuis
 * `processing` (sinon 0 ligne). Renvoie true si la transition a eu lieu.
 */
export async function enregistrerResultat(ex: Executeur, entree: EntreeResultat): Promise<boolean> {
  const now = entree.now ?? new Date();
  const sentAt = entree.status === 'sent' ? now.toISOString() : null;
  const r = await ex.query<{ action_id: string | null }>(
    `update linkedin_action_queue
       set status = $3, sent_at = $4, error_code = $5, error_message = $6, updated_at = now()
     where id = $1 and organization_id = $2 and status = 'processing'
     returning action_id`,
    [
      entree.queueId,
      entree.organizationId,
      entree.status,
      sentAt,
      entree.errorCode ?? null,
      entree.errorMessage ?? null,
    ],
  );
  const transitionFaite = (r.rowCount ?? 0) > 0;

  // Referme la boucle vers le séquenceur : sans cet appel, l'action restait à son
  // statut d'émission et la table `outcomes` vide, donc toute la mesure — actions
  // envoyées, statistiques de campagne, tableau de bord — affichait zéro sur des
  // messages pourtant réellement partis.
  const actionId = r.rows[0]?.action_id;
  if (transitionFaite && entree.status === 'sent' && actionId) {
    await ex.query('select app.mark_action_dispatched($1)', [actionId]);
    await poserEcheanceApresDepartDepuisAction(ex, actionId, now);
  }

  return transitionFaite;
}

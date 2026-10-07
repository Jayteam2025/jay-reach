/**
 * File d'actions LinkedIn (`linkedin_action_queue`) : réclamation de la prochaine
 * action sous rythme, et enregistrement de son résultat. Portage depuis
 * `apps/web/lib/linkedin/queue.ts` pour que le worker puisse l'importer ; le
 * rythme pur vient de `pacing.ts`, ici on ne fait que les I/O SQL.
 *
 * Écarts assumés avec l'original : le candidat se filtre sur `q.method =
 * 'serveur'` (envoi par le serveur, plus par l'extension), et la réclamation
 * refuse tant que la session du serveur n'est pas `active` ou que
 * `linkedin_server_sessions.envoi_pause_jusqua` n'est pas passée.
 */
import type { Executeur } from '../executeur.js';
import { dansUneTransaction } from '../transaction.js';
import { poserEcheanceApresDepart } from '../sequencer/echeance.js';
import {
  decideCanSend,
  heureLocale,
  versIso,
  PROCESSING_TIMEOUT_MIN,
  HARD_CAP_7_DAYS,
  type PaceReason,
} from './pacing.js';

/** Texte écrit sur une action serveur dont on ignore si elle est partie : elle n'est jamais rejouée. */
export const MESSAGE_RESULTAT_INDETERMINE =
  'LinkedIn a peut-être reçu cette action avant l’arrêt du worker : vérifiez sur LinkedIn, elle ne sera pas rejouée.';

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
  | 'canal_en_pause'
  | 'session_inactive';

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
  const last = await ex.query<{ sent_at: string | Date }>(
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
    lastSentAtIso: last.rows[0]?.sent_at ? versIso(last.rows[0].sent_at) : null,
  };
}

/**
 * Met l'envoi en pause jusqu'à `jusqua` : la réclamation refuse `canal_en_pause`
 * tant que cette date n'est pas passée. Une pause ne se raccourcit jamais : si
 * une échéance plus lointaine est déjà posée, elle est conservée (`greatest`).
 *
 * Renvoie `false` quand aucune ligne de session n'existe pour l'organisation :
 * rien n'a été posé, et l'appelant ne doit pas croire le canal en pause.
 */
export async function mettreEnPauseEnvoiLinkedIn(ex: Executeur, organisationId: string, jusqua: Date): Promise<boolean> {
  const res = await ex.query(
    `update linkedin_server_sessions
        set envoi_pause_jusqua = greatest(coalesce(envoi_pause_jusqua, $2::timestamptz), $2::timestamptz)
      where organization_id = $1`,
    [organisationId, jusqua.toISOString()],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Répare les lignes coincées en `processing` (appelant mort en plein call), sans envoyer
 * quoi que ce soit : aucun quota, aucun appel LinkedIn. Appelée en tête de la réclamation
 * ET par le handler d'envoi avant sa sonde de file vide, pour qu'une ligne périmée devienne
 * visible même quand il ne reste plus rien à envoyer.
 *
 * DEUX traitements, parce que « coincée » ne veut pas dire la même chose :
 *  - `extension_auto` : l'extension n'avait encore rien envoyé, la remise en
 *    attente est sûre (chemin historique, inchangé) ;
 *  - `serveur` : le POST a pu être ACCEPTÉ par LinkedIn avant que le worker meure.
 *    La remettre en `pending` inviterait la personne une seconde fois, ce qui ne se
 *    rattrape pas. Elle passe en statut terminal `resultat_indetermine` : au pire une
 *    action perdue, visible à l'écran, rattrapable à la main. Aucune variante plus
 *    fine (distinguer les lignes déjà tracées) : un garde-fou se lit en une seconde.
 */
export async function reparerLignesCoincees(ex: Executeur, organisationId: string, maintenant: Date = new Date()): Promise<void> {
  const stuckCutoff = new Date(maintenant.getTime() - PROCESSING_TIMEOUT_MIN * 60_000).toISOString();
  await ex.query(
    `update linkedin_action_queue
         set status = 'pending', processing_started_at = null, updated_at = now()
       where organization_id = $1 and status = 'processing' and processing_started_at < $2
         and method <> 'serveur'`,
    [organisationId, stuckCutoff],
  );
  await ex.query(
    `update linkedin_action_queue /* jr:linkedin_coincees_serveur */
         set status = 'failed', error_code = 'resultat_indetermine',
             error_message = $3, updated_at = now()
       where organization_id = $1 and status = 'processing' and processing_started_at < $2
         and method = 'serveur'`,
    [organisationId, stuckCutoff, MESSAGE_RESULTAT_INDETERMINE],
  );
}

type VerdictRythme =
  | { readonly ok: true }
  | { readonly ok: false; readonly motif: MotifRefus; readonly attendreMinutes?: number };

/**
 * Le rythme appliqué à une organisation : mode manuel, puis `decideCanSend` (fenêtre, plafond
 * 7 j dur, intervalle irrégulier de 1 à 20 minutes), puis plafond quotidien du curseur. Pur.
 * `attendreMinutes` n'est rendu que pour l'intervalle, seul refus qui se lève de lui-même
 * à une échéance connue.
 */
function jugerRythme(stats: StatsRythme, now: Date): VerdictRythme {
  // Mode manuel : rien ne part de soi-même. État IMPOSSIBLE en base aujourd'hui : la migration
  // 20260831160000 a resserré la contrainte à `mode = 'auto'` (« Déprécié : seul auto existe »).
  // La branche est gardée par précaution, parce qu'elle est conservatrice (rien ne part) et que la
  // contrainte pourra être relâchée : ce produit veut que tout soit réglable à l'écran.
  if (stats.mode === 'manual') {
    return { ok: false, motif: 'manual_mode' };
  }

  // Pacing pur : fenêtre + plafond 7 j (dur) + intervalle.
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
    return decision.waitMinutes === undefined
      ? { ok: false, motif: decision.reason }
      : { ok: false, motif: decision.reason, attendreMinutes: decision.waitMinutes };
  }

  // Plafond quotidien du curseur (volume/jour choisi par l'org).
  if (stats.sentToday >= stats.dailyCap) {
    return { ok: false, motif: 'daily_cap_reached' };
  }
  return { ok: true };
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
 * Ordre : 1. requeue des lignes coincées (seule écriture avant les refus : une
 * réparation d'état, pas un envoi, qui ne consomme aucun quota et ne touche pas
 * LinkedIn, donc faite même session bloquée ou canal en pause) ; 2. refus
 * `session_inactive` (aucune session `active` pour l'organisation) puis
 * `canal_en_pause`, au même rang, rendus avant toute réclamation : aucune ligne
 * n'est réclamée ni son `attempts` touché. La garde vit ici et non chez
 * l'appelant : worker, MCP et écran appellent cette fonction.
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

  // 1. Réparation des lignes coincées en processing (voir `reparerLignesCoincees`).
  // AVANT les refus : c'est une réparation d'état, pas un envoi. Session bloquée
  // ou canal en pause, une ligne coincée ne doit pas rester annoncée `processing`.
  await reparerLignesCoincees(ex, orgId, now);

  // 2. Session du serveur : le canal n'est disponible que si elle est `active`
  // (absente, bloquée ou sans ligne : rien ne part). Puis pause d'envoi posée
  // sur cette même session. Les deux refus précèdent toute réclamation.
  const session = await ex.query<{ status: string; envoi_pause_jusqua: string | Date | null }>(
    `select status, envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1`,
    [orgId],
  );
  if (session.rows[0]?.status !== 'active') {
    return { action: null, motif: 'session_inactive' };
  }
  const echeancePause = session.rows[0].envoi_pause_jusqua;
  if (echeancePause && new Date(echeancePause).getTime() > now.getTime()) {
    return { action: null, motif: 'canal_en_pause' };
  }

  const stats = await chargerStatsRythme(ex, orgId, now);

  // 3 à 5. Rythme : mode manuel, fenêtre, plafonds, intervalle. Un seul jugement, partagé
  // avec `prochainEnvoiLinkedIn` : la date qu'il pose et la décision d'ici ne peuvent pas diverger.
  const verdict = jugerRythme(stats, now);
  if (!verdict.ok) {
    return { action: null, motif: verdict.motif };
  }

  // 6. Prochaine ligne pending (la plus ancienne planifiée), claim atomique.
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
  // UNE transaction pour les trois écritures : sans elle, une panne entre `processing -> sent`
  // et `mark_action_dispatched` laissait la ligne `sent` mais l'action jamais marquée partie ni
  // l'échéance posée, et la nouvelle tentative ne rejouait plus rien (la ligne n'est plus
  // `processing`) : l'inscription restait bloquée à cette étape, sans bruit. Ici tout ou rien :
  // en cas d'échec la ligne reste `processing` et la réparation des lignes coincées la rendra
  // visible comme résultat indéterminé, ce qui est vrai.
  return dansUneTransaction(ex, async (tx) => {
    const r = await tx.query<{ action_id: string | null }>(
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
      await tx.query('select app.mark_action_dispatched($1)', [actionId]);
      await poserEcheanceApresDepartDepuisAction(tx, actionId, now);
    }

    return transitionFaite;
  });
}

/**
 * Remet une action `processing` en `pending` quand on SAIT que rien n'est parti
 * (lecture refusée, session ou canal à l'arrêt). Transition depuis `processing`
 * uniquement : une ligne déjà `sent` ou `failed` n'est jamais rouverte.
 *
 * `comptee: true` garde la tentative (une panne répétée d'une lecture ne doit pas
 * boucler à l'infini : à `maxTentatives` la ligne passe `failed`). `comptee: false`
 * rend la tentative, car l'action n'a pas été essayée par sa faute : une session
 * bloquée ou une pause d'un jour ne doit pas la faire vieillir. Rend true si la
 * ligne a bougé.
 */
export async function remettreActionEnAttente(
  ex: Executeur,
  organisationId: string,
  queueId: string,
  options: { readonly comptee: boolean; readonly maxTentatives?: number },
): Promise<boolean> {
  const res = await ex.query(
    `update linkedin_action_queue /* jr:linkedin_action_remettre */
        set status = case when $3::boolean and attempts >= $4::int then 'failed' else 'pending' end,
            attempts = case when $3::boolean then attempts else greatest(attempts - 1, 0) end,
            error_code = case when $3::boolean and attempts >= $4::int then 'trop_de_tentatives' else null end,
            error_message = case when $3::boolean and attempts >= $4::int
              then 'La lecture du profil a échoué plusieurs fois de suite : l’action est abandonnée.' else null end,
            processing_started_at = null, updated_at = now()
      where id = $1 and organization_id = $2 and status = 'processing'`,
    [queueId, organisationId, options.comptee, options.maxTentatives ?? 3],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Sonde bon marché (`maintenant` : la même horloge, celle du worker, que `reclamerProchaineAction`,
 * pour que les deux jugent les mêmes échéances). : existe-t-il au moins une action serveur en attente ? Elle ne
 * répond QUE « la file est-elle vide » ; le rythme (fenêtre, plafonds, intervalle,
 * campagne) reste décidé par `reclamerProchaineAction`. Sert à ne pas ouvrir le
 * navigateur, ni relever la sortie par le proxy, à chaque tick sans travail.
 */
export async function existeActionServeurEnAttente(
  ex: Executeur,
  organisationId: string,
  maintenant: Date = new Date(),
): Promise<boolean> {
  // Mêmes garde-fous « il y a quelque chose à envoyer MAINTENANT » que la réclamation, et
  // seulement eux : échéance atteinte, campagne active (F14), canal hors pause. Ni l'intervalle,
  // ni la fenêtre horaire, ni les plafonds : c'est `reclamerProchaineAction` qui les juge.
  const res = await ex.query<{ existe: boolean }>(
    `select (
        exists (
          select 1 from linkedin_action_queue q /* jr:linkedin_envoi_en_attente */
            left join actions a on a.id = q.action_id
            left join enrollments e on e.id = a.enrollment_id
            left join campaigns camp on camp.id = e.campaign_id
           where q.organization_id = $1 and q.status = 'pending' and q.method = 'serveur'
             and q.scheduled_for <= $2
             and (q.action_id is null or camp.status = 'active')
        )
        and not exists (
          select 1 from linkedin_server_sessions s
           where s.organization_id = $1 and s.envoi_pause_jusqua > $2
        )
      ) as existe`,
    [organisationId, maintenant.toISOString()],
  );
  return res.rows[0]?.existe === true;
}

export type MotifAucunEnvoi = MotifRefus | 'action_en_cours' | 'file_vide';

export type ProchainEnvoi =
  /**
   * `raison` distingue « le rythme autorise un envoi » de « une ligne est restée en cours et
   * doit être close ». Le producteur crée un job dans les deux cas, mais le handler ne doit pas
   * ouvrir Chromium ni payer un écho d'IP pour une réparation, et un écran qui les confond
   * annonce « prêt à envoyer » un dimanche à 3 h du matin, file vide.
   *
   * Obligatoire, et non optionnel : trois sites rendent une date, et un champ qu'on peut omettre
   * se laisse oublier par celui qu'on ajoute ensuite.
   */
  | { readonly quand: Date; readonly motif: null; readonly raison: 'envoi' | 'reparation' }
  | { readonly quand: null; readonly motif: MotifAucunEnvoi };

/**
 * Le moment où un envoi serveur redevient possible pour une organisation, ou `null` quand
 * aucun ne l'est. LECTURE SEULE, sans navigateur : elle sert à dater le job d'envoi plutôt
 * qu'à réveiller le worker toutes les minutes pour que la réclamation réponde « pas encore ».
 *
 * Elle juge avec les mêmes règles que `reclamerProchaineAction` (`jugerRythme`), et ne
 * rend une date que pour ce qui se lève à une échéance connue :
 *  - tout est prêt : maintenant ;
 *  - l'intervalle irrégulier de 1 à 20 minutes n'est pas écoulé : la minute où il le sera ;
 *  - fenêtre horaire fermée, plafond atteint, mode manuel, pause, file vide : `null`. Aucune
 *    date n'est devinée ; l'appelant réévalue au tick suivant, ce qui ne coûte que ces SELECT.
 *
 * Une action serveur en vol (`processing` depuis moins de `PROCESSING_TIMEOUT_MIN`) donne
 * `null` : un second job viserait la même session. Une ligne coincée depuis plus longtemps
 * donne « maintenant » même sans rien en attente : seul le handler la répare, et sans job
 * elle resterait `processing` pour toujours, annoncée comme en cours.
 */
export async function prochainEnvoiLinkedIn(
  ex: Executeur,
  organisationId: string,
  maintenant: Date = new Date(),
): Promise<ProchainEnvoi> {
  const session = await ex.query<{ status: string; envoi_pause_jusqua: string | Date | null }>(
    `select status, envoi_pause_jusqua from linkedin_server_sessions where organization_id = $1`,
    [organisationId],
  );
  if (session.rows[0]?.status !== 'active') {
    return { quand: null, motif: 'session_inactive' };
  }
  const echeancePause = session.rows[0].envoi_pause_jusqua;
  if (echeancePause && new Date(echeancePause).getTime() > maintenant.getTime()) {
    return { quand: null, motif: 'canal_en_pause' };
  }

  const coupure = new Date(maintenant.getTime() - PROCESSING_TIMEOUT_MIN * 60_000).toISOString();
  const enVol = await ex.query<{ recentes: string; perimees: string }>(
    `select count(*) filter (where processing_started_at >= $2) as recentes,
            count(*) filter (where processing_started_at < $2) as perimees
       from linkedin_action_queue /* jr:linkedin_envoi_en_cours */
      where organization_id = $1 and status = 'processing' and method = 'serveur'`,
    [organisationId, coupure],
  );
  if (Number(enVol.rows[0]?.recentes ?? 0) > 0) {
    return { quand: null, motif: 'action_en_cours' };
  }
  if (Number(enVol.rows[0]?.perimees ?? 0) > 0) {
    return { quand: maintenant, motif: null, raison: 'reparation' };
  }

  if (!(await existeActionServeurEnAttente(ex, organisationId, maintenant))) {
    return { quand: null, motif: 'file_vide' };
  }

  const verdict = jugerRythme(await chargerStatsRythme(ex, organisationId, maintenant), maintenant);
  if (verdict.ok) {
    return { quand: maintenant, motif: null, raison: 'envoi' };
  }
  if (verdict.motif === 'too_soon' && verdict.attendreMinutes !== undefined) {
    return { quand: new Date(maintenant.getTime() + verdict.attendreMinutes * 60_000), motif: null, raison: 'envoi' };
  }
  return { quand: null, motif: verdict.motif };
}

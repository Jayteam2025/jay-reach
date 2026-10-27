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
import { cloreDepartReel } from '../sequencer/echeance.js';
import { versInstant } from '../temps.js';
import { compterRequetesLinkedIn, plafondDuJour, type ClePlafond } from '../fonctions/plafonds.js';
import { balayerReponsesSansSort, existeReponseSansSort } from './reponse-manuelle.js';
import { HEURES_ENVOI_LINKEDIN_PAR_DEFAUT } from './reglages-envoi.js';
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

/**
 * Code posé sur une ligne `pending` dont le message attend que l'invitation soit acceptée. Il sert
 * de MARQUE : l'ordre des candidates (les neuves d'abord) et le rythme (une vérification compte
 * comme un passage) le lisent. Il disparaît à l'envoi (`enregistrerResultat` réécrit le code).
 */
export const CODE_ATTENTE_ACCEPTATION = 'attente_acceptation';
/** Code d'une ligne `cancelled` et d'une action `skipped` : l'invitation n'a pas été acceptée à temps. */
export const CODE_INVITATION_NON_ACCEPTEE = 'invitation_non_acceptee';

export interface ActionReclamee {
  readonly id: string;
  readonly kind: 'invite' | 'message';
  readonly linkedinUrl: string;
  readonly messageBody: string | null;
  /** Le contact visé ; absent ou `null` pour une ligne que l'extension a créée sans contact. */
  readonly contactId?: string | null;
  /** `reponse` : message de l'opérateur à quelqu'un qui lui a écrit. Absent = `sequence`. */
  readonly origine?: OrigineAction;
}

/**
 * `sequence` : une action du séquenceur, soumise au rythme. `reponse` : l'opérateur répond lui-même
 * (`reponse-manuelle.ts`), elle passe devant, hors fenêtre horaire, hors rythme et hors plafond
 * hebdomadaire, et la garde d'exclusion ne l'arrête pas.
 */
export type OrigineAction = 'sequence' | 'reponse';

interface CandidateFile {
  readonly id: string;
  readonly kind: TypeActionLinkedIn;
  readonly origine: OrigineAction;
}

/** Le type d'une action de la file : le rythme se juge PAR type (invitation ou message). */
export type TypeActionLinkedIn = ActionReclamee['kind'];

/**
 * Le plafond hebdomadaire de chaque type, dans `organization_settings` : c'est l'invitation qui met
 * un compte en danger, le message beaucoup moins, d'où deux curseurs (voir `CLES_REGLAGES`).
 */
const CLE_PLAFOND_HEBDOMADAIRE = {
  invite: 'linkedin_invitations_par_semaine',
  message: 'linkedin_messages_par_semaine',
} as const satisfies Record<TypeActionLinkedIn, ClePlafond>;

export type MotifRefus =
  | PaceReason
  | 'manual_mode'
  | 'daily_cap_reached'
  | 'queue_empty'
  | 'race_retry'
  | 'canal_en_pause'
  | 'session_inactive'
  | 'contact_exclu';

export type ResultatReclamation =
  | { readonly action: ActionReclamee; readonly motif: null }
  | { readonly action: null; readonly motif: MotifRefus };

/** Ce qui se compte, se plafonne et se déduit séparément pour un type d'action. */
export interface CompteurType {
  readonly plafondHebdo: number;
  readonly plafondQuotidien: number;
  readonly envoyes7Jours: number;
  readonly envoyesAujourdhui: number;
}

interface StatsRythme {
  readonly mode: 'auto' | 'hybrid' | 'manual';
  readonly startHour: number;
  readonly endHour: number;
  readonly days: number[];
  readonly timezone: string;
  readonly parType: Readonly<Record<TypeActionLinkedIn, CompteurType>>;
  /** Dernier envoi, tous types : l'intervalle irrégulier protège le COMPTE, pas un type. */
  readonly lastSentAtIso: string | null;
}

async function chargerStatsRythme(ex: Executeur, orgId: string, now: Date): Promise<StatsRythme> {
  // L'écran enregistre les jours, la plage horaire et le fuseau dans `linkedin_settings`. Le VOLUME,
  // lui, ne s'y lit plus : `weekly_cap` et `daily_cap` de cette table sont des colonnes héritées,
  // deux plafonds (invitations, messages) vivent dans `organization_settings` comme tous les autres.
  const settings = await ex.query<{
    mode: 'auto' | 'hybrid' | 'manual';
    send_days: number[] | null;
    send_from_hour: number | null;
    send_to_hour: number | null;
    timezone: string | null;
  }>(
    `select mode, send_days, send_from_hour, send_to_hour, timezone
       from linkedin_settings where organization_id = $1`,
    [orgId],
  );
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const counts = await ex.query<{ kind: TypeActionLinkedIn; last7: string; today: string }>(
    `select kind,
       count(*) filter (where sent_at >= $2) as last7,
       count(*) filter (where sent_at >= $3) as today
     from linkedin_action_queue /* jr:linkedin_envoyes_par_type */
     where organization_id = $1 and status = 'sent' and origine = 'sequence'
     group by kind`,
    [orgId, sevenDaysAgo, oneDayAgo],
  );
  // Le dernier passage vers LinkedIn : un envoi parti, OU la vérification d'un message qui attend
  // l'acceptation de l'invitation (ligne `pending` portant `attente_acceptation`, datée par son
  // `updated_at`). Une vérification est une requête de plus sur le compte : sans elle, vingt
  // messages en attente seraient vérifiés l'un derrière l'autre, sans l'intervalle de 1 à 20 minutes
  // qui rend le rythme humain.
  const last = await ex.query<{ sent_at: string | Date | null }>(
    `select max(t) as sent_at /* jr:linkedin_dernier_envoi_toutes_origines */
       from (
         select sent_at as t from linkedin_action_queue
          where organization_id = $1 and status = 'sent'
         union all
         select updated_at as t from linkedin_action_queue
          where organization_id = $1 and status = 'pending' and error_code = '${CODE_ATTENTE_ACCEPTATION}'
       ) passages`,
    [orgId],
  );
  const r = settings.rows[0];
  const jours = (r?.send_days ?? []).filter((j) => j >= 1 && j <= 7);
  const nbJoursActifs = Math.max(1, jours.length || HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.jours.length);

  const compteur = async (kind: TypeActionLinkedIn): Promise<CompteurType> => {
    const plafondHebdo = await plafondDuJour(ex, orgId, CLE_PLAFOND_HEBDOMADAIRE[kind]);
    const ligne = counts.rows.find((c) => c.kind === kind);
    return {
      plafondHebdo,
      // Le plafond quotidien se DÉDUIT du curseur hebdomadaire, et `daily_cap` est
      // volontairement ignoré.
      //
      // L'écran ne saisit plus que le volume par semaine ; `daily_cap` est une
      // colonne héritée que plus personne n'écrit. Sur la base, elle vaut encore 25
      // alors que le curseur dit 100 par semaine sur cinq jours — soit vingt. S'y
      // fier ferait envoyer cent vingt-cinq invitations en affichant cent : le
      // réglage visible mentirait sur ce qui part, ce qui est pire que pas de
      // réglage du tout.
      plafondQuotidien: Math.max(1, Math.ceil(plafondHebdo / nbJoursActifs)),
      envoyes7Jours: Number(ligne?.last7 ?? 0),
      envoyesAujourdhui: Number(ligne?.today ?? 0),
    };
  };

  return {
    mode: r?.mode ?? 'auto',
    startHour: r?.send_from_hour ?? HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.debutHeure,
    endHour: r?.send_to_hour ?? HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.finHeure,
    days: jours.length > 0 ? jours : [...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.jours],
    timezone: r?.timezone ?? HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.fuseau,
    parType: { invite: await compteur('invite'), message: await compteur('message') },
    lastSentAtIso: last.rows[0]?.sent_at ? versIso(last.rows[0].sent_at) : null,
  };
}

/**
 * Volume d'envoi par type, pour l'écran de réglages : le plafond appliqué et ce qui a
 * déjà été envoyé sur sept jours glissants.
 *
 * Elle appelle `chargerStatsRythme`, c'est à dire exactement ce que le moteur consulte
 * avant chaque envoi, au lieu de recompter de son côté. Un second comptage finirait par
 * diverger du premier, et l'écran annoncerait un chiffre que le moteur ne connaît pas.
 */
export async function lireVolumeEnvoiLinkedIn(
  ex: Executeur,
  organisationId: string,
  maintenant: Date = new Date(),
): Promise<Readonly<Record<TypeActionLinkedIn, CompteurType>>> {
  const stats = await chargerStatsRythme(ex, organisationId, maintenant);
  return stats.parType;
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
  // Une réponse de l'opérateur n'a ni action ni inscription : rien d'autre ne préviendrait personne.
  // Le balayage règle aussi bien les lignes que l'on vient de coincer que celles dont le signalement
  // direct a échoué. Un échec du filet ne doit pas empêcher d'envoyer : il sera rejoué au tick suivant.
  try {
    await balayerReponsesSansSort(ex, organisationId);
  } catch (err) {
    console.error(`[linkedin] balayage des réponses à retenter (${err instanceof Error ? err.name : 'erreur'})`);
  }
}

type VerdictRythme =
  | { readonly ok: true }
  | { readonly ok: false; readonly motif: MotifRefus; readonly attendreMinutes?: number };

/**
 * Le rythme appliqué à une organisation POUR UN TYPE D'ACTION (celui de l'action jugée) : mode manuel, puis `decideCanSend` (fenêtre, plafond
 * 7 j dur, intervalle irrégulier de 1 à 20 minutes), puis plafond quotidien du curseur. Pur.
 * `attendreMinutes` n'est rendu que pour l'intervalle, seul refus qui se lève de lui-même
 * à une échéance connue.
 */
function jugerRythme(stats: StatsRythme, kind: TypeActionLinkedIn, now: Date): VerdictRythme {
  const c = stats.parType[kind];
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
    sentLast7Days: c.envoyes7Jours,
    // Le curseur de l'opérateur POUR CE TYPE, sans jamais dépasser le plafond dur : c'est
    // lui qui protège le compte LinkedIn, pas le réglage.
    cap7Days: Math.min(c.plafondHebdo, HARD_CAP_7_DAYS),
    lastSentAtIso: stats.lastSentAtIso,
    minutesSinceLastSent,
  });
  if (!decision.ok) {
    return decision.waitMinutes === undefined
      ? { ok: false, motif: decision.reason }
      : { ok: false, motif: decision.reason, attendreMinutes: decision.waitMinutes };
  }

  // Plafond quotidien du curseur (volume/jour choisi par l'org).
  if (c.envoyesAujourdhui >= c.plafondQuotidien) {
    return { ok: false, motif: 'daily_cap_reached' };
  }
  return { ok: true };
}

/**
 * La plus ancienne action serveur prête à partir (échéance atteinte, campagne active) POUR CHAQUE
 * TYPE, la plus ancienne en tête. Les plafonds sont par type : juger la seule plus ancienne ligne
 * arrêterait toute la file dès que son type est plafonné, y compris l'autre type qui a du budget.
 * Lecture seule : la réclamation, elle, est l'`update` atomique qui suit.
 */
async function prochainesCandidates(
  ex: Executeur,
  organisationId: string,
  now: Date,
): Promise<CandidateFile[]> {
  const candidates = await ex.query<CandidateFile>(
    `select id, kind, origine from (
       select distinct on (q.kind) q.id, q.kind, q.origine, q.scheduled_for,
              coalesce(q.error_code = '${CODE_ATTENTE_ACCEPTATION}', false) as en_attente /* jr:linkedin_candidates_par_type */
         from linkedin_action_queue q
         left join actions a on a.id = q.action_id
         left join enrollments e on e.id = a.enrollment_id
         left join campaigns camp on camp.id = e.campaign_id
        where q.organization_id = $1 and q.status = 'pending'
          and q.method = 'serveur' and q.scheduled_for <= $2
          and (q.action_id is null or camp.status = 'active')
        -- Une ligne qui ATTEND l'acceptation d'une invitation passe après celles qui n'ont jamais été
        -- essayées : sa vérification quotidienne ne doit pas retenir un message neuf, dont l'invitation
        -- est peut-être déjà acceptée.
        order by q.kind, (q.origine = 'reponse') desc,
                 coalesce(q.error_code = '${CODE_ATTENTE_ACCEPTATION}', false) asc, q.scheduled_for asc, q.id asc
     ) par_type
     -- Même règle ENTRE types : une invitation neuve passe avant un message qui attend l'acceptation.
     order by (origine = 'reponse') desc, en_attente asc, scheduled_for asc, id asc`,
    [organisationId, now.toISOString()],
  );
  return candidates.rows;
}

/**
 * Juge chaque candidate sur le plafond de SON type et rend la plus ancienne qui passe. Aucune ne
 * passe : le verdict le plus utile (celui qui porte une attente datée, sinon celui de la plus
 * ancienne). Un seul jugement, partagé par la réclamation et par `prochainEnvoiLinkedIn` : la date
 * qu'il pose et la décision de la réclamation ne peuvent pas diverger.
 */
function jugerCandidates(
  candidates: ReadonlyArray<CandidateFile>,
  stats: StatsRythme,
  now: Date,
): { readonly candidate: CandidateFile; readonly verdict: VerdictRythme } {
  const juges = candidates.map((candidate) => ({
    candidate,
    // Une réponse de l'opérateur échappe au rythme : ni fenêtre, ni intervalle, ni plafonds de volume.
    // Session inactive et canal en pause la retiennent déjà, plus haut, pour toutes les lignes.
    verdict:
      candidate.origine === 'reponse'
        ? ({ ok: true } satisfies VerdictRythme)
        : jugerRythme(stats, candidate.kind, now),
  }));
  const premier = juges.find((j) => j.verdict.ok);
  if (premier) return premier;
  const datee = juges.find((j) => !j.verdict.ok && j.verdict.attendreMinutes !== undefined);
  // `candidates` n'est jamais vide ici : les deux appelants ont déjà rendu `queue_empty` / `file_vide`.
  return datee ?? juges[0]!;
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

  // 3. Prochaine ligne pending (la plus ancienne planifiée). Choisie AVANT le jugement du rythme :
  // les plafonds sont par type, on ne sait lequel appliquer qu'en connaissant l'action visée.
  const candidates = await prochainesCandidates(ex, orgId, now);
  if (candidates.length === 0) {
    return { action: null, motif: 'queue_empty' };
  }

  // 4 à 6. Rythme : mode manuel, fenêtre, plafonds du type, intervalle. Un jugement PAR TYPE, la plus
  // ancienne qui passe est réclamée : un type plafonné ne retient pas l'autre. Partagé avec
  // `prochainEnvoiLinkedIn`.
  const stats = await chargerStatsRythme(ex, orgId, now);
  const { candidate, verdict } = jugerCandidates(candidates, stats, now);
  if (!verdict.ok) {
    return { action: null, motif: verdict.motif };
  }
  const id = candidate.id;

  // 6 bis. Garde d'exclusion : le contact a pu être exclu (réponse humaine) APRÈS l'enfilement, ou la
  // ligne avoir échappé à l'annulation (`annulerEnvoisEnFile`). Elle vit ici, dans la réclamation, pour
  // que worker, MCP et écran la partagent. La ligne est ANNULÉE et non laissée `pending` : plus ancienne
  // de son type, elle serait choisie à chaque tick et affamerait celles qui la suivent. Jamais une ligne
  // `origine = 'reponse'` : elle part justement vers quelqu'un que la réponse vient d'exclure.
  const exclue = await ex.query<{ action_id: string | null }>(
    `update linkedin_action_queue q /* jr:linkedin_garde_contact_exclu */
        set status = 'cancelled', error_code = 'contact_exclu', updated_at = now()
      where q.id = $1 and q.organization_id = $2 and q.status = 'pending' and q.origine <> 'reponse'
        and (exists (select 1 from contacts c
                      where c.id = q.contact_id and c.organization_id = q.organization_id
                        and c.status = 'do_not_contact')
             -- Une ligne sans contact_id (engageur collecte) ou enfilee APRES l'exclusion : ni enqueueAction
             -- ni enqueueLinkedInAction ne consultent suppressions, seule cette garde l'arrete. Comparaison
             -- par adresse, SEULEMENT si celle de la ligne est un profil (url_linkedin_normalisee ne valide
             -- rien : /in/ et /in ne designent personne).
             or (app.url_linkedin_normalisee(q.linkedin_url) ~ '^linkedin\\.com/in/[^/]+$'
                 and exists (select 1 from suppressions su
                              where su.organization_id = q.organization_id and su.scope = 'linkedin'
                                and (su.expires_at is null or su.expires_at > now())
                                and app.url_linkedin_normalisee(su.value) = app.url_linkedin_normalisee(q.linkedin_url))))
      returning q.action_id`,
    [id, orgId],
  );
  if (exclue.rows.length > 0) {
    const actionId = exclue.rows[0]?.action_id;
    if (actionId) {
      // `organization_id` : défense en profondeur. `id` vient de `prochainesCandidates`, déjà filtré par
      // organisation : aucun chemin ne le prouve, et aucun contrôle ne prétend le faire.
      await ex.query(
        `update actions set status = 'skipped', error = 'enrollment_inactive'
          where organization_id = $1 and id = $2 and status in ('scheduled', 'approved')`,
        [orgId, actionId],
      );
    }
    return { action: null, motif: 'contact_exclu' };
  }

  // 7. Claim atomique.
  const claimed = await ex.query<ActionReclamee>(
    `update linkedin_action_queue
         set status = 'processing', processing_started_at = $2,
             attempts = attempts + 1, updated_at = now()
       where id = $1 and status = 'pending'
       returning id, kind, linkedin_url as "linkedinUrl", message_body as "messageBody",
                 contact_id as "contactId", origine`,
    [id, now.toISOString()],
  );
  const row = claimed.rows[0];
  if (!row) {
    return { action: null, motif: 'race_retry' };
  }
  return {
    action: {
      id: row.id,
      kind: row.kind,
      linkedinUrl: row.linkedinUrl,
      messageBody: row.messageBody,
      contactId: row.contactId ?? null,
      origine: row.origine,
    },
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
 * implémentation partagée, `cloreDepartReel`. Ici, seule la résolution
 * propre à LinkedIn : retrouver l'inscription (`campaign_id`, `current_step`) à
 * partir de l'`actionId` posé sur la ligne de file.
 */
async function poserEcheanceApresDepartDepuisAction(ex: Executeur, actionId: string, now: Date): Promise<void> {
  // Le rang de l'étape qui part se lit dans la même requête : `cloreDepartReel` le compare à
  // `current_step` pour distinguer un envoi normal d'un rejeu après pause (issue #160).
  const inscription = await ex.query<{
    enrollment_id: string;
    campaign_id: string;
    current_step: number;
    rang_etape: number;
  }>(
    `select en.id as enrollment_id, en.campaign_id, en.current_step,
            (select count(*)::int from sequence_steps o
              where o.campaign_id = s.campaign_id and o.position < s.position) as rang_etape
       from actions a
       join enrollments en on en.id = a.enrollment_id
       join sequence_steps s on s.id = a.step_id
      where a.id = $1`,
    [actionId],
  );
  const ligne = inscription.rows[0];
  if (!ligne) return;
  await cloreDepartReel(
    ex,
    {
      enrollmentId: ligne.enrollment_id,
      campaignId: ligne.campaign_id,
      currentStep: ligne.current_step,
      rangEtapePartie: ligne.rang_etape,
    },
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
 * bloquée ou une pause d'un jour ne doit pas la faire vieillir. Rend le statut que la
 * ligne vient de prendre (`pending`, ou `failed` si les tentatives sont épuisées : l'appelant
 * doit alors arrêter la séquence), ou `null` si elle n'a pas bougé.
 */
export async function remettreActionEnAttente(
  ex: Executeur,
  organisationId: string,
  queueId: string,
  options: { readonly comptee: boolean; readonly maxTentatives?: number },
): Promise<'pending' | 'failed' | null> {
  const res = await ex.query<{ status: 'pending' | 'failed' }>(
    `update linkedin_action_queue /* jr:linkedin_action_remettre */
        set status = case when $3::boolean and attempts >= $4::int then 'failed' else 'pending' end,
            attempts = case when $3::boolean then attempts else greatest(attempts - 1, 0) end,
            error_code = case when $3::boolean and attempts >= $4::int then 'trop_de_tentatives' else null end,
            error_message = case when $3::boolean and attempts >= $4::int
              then 'La lecture du profil a échoué plusieurs fois de suite : l’action est abandonnée.' else null end,
            processing_started_at = null, updated_at = now()
      where id = $1 and organization_id = $2 and status = 'processing'
  returning status`,
    [queueId, organisationId, options.comptee, options.maxTentatives ?? 3],
  );
  return res.rows[0]?.status ?? null;
}

export interface EntreeMessagePasEncoreRelation {
  readonly organizationId: string;
  readonly queueId: string;
  /** L'horloge du passage, la même que celle de la réclamation. */
  readonly maintenant: Date;
  /** Où replanifier la vérification (minuit suivant, dans le fuseau de l'envoi) : au plus une par jour. */
  readonly prochaineVerification: Date;
}

export type SortieMessagePasEncoreRelation =
  /** Le message attend : la ligne est de nouveau `pending`, replanifiée, l'action reste `scheduled`. */
  | { readonly issue: 'en_attente'; readonly jours: number }
  /** Délai écoulé : l'étape est sautée et l'inscription passe à la suivante. */
  | { readonly issue: 'saute'; readonly jours: number; readonly contactId: string | null }
  /** Pas une action de séquence (réponse de l'opérateur, ligne de l'extension) : l'appelant applique l'échec ordinaire. */
  | { readonly issue: 'sans_sequence' };

/**
 * LinkedIn a refusé un message de séquence (`cannot_message`) : la personne n'est, en règle générale,
 * pas encore une relation de premier degré. Ce n'est pas un échec de la séquence, c'est une attente.
 * Rien n'est parti (le refus est le fait de LinkedIn), la réessayer plus tard ne risque pas de doublon.
 *
 *  - Avant `linkedin_attente_acceptation_jours` jours (compté depuis l'envoi de l'invitation à cette
 *    personne, sinon depuis l'arrivée de l'étape) : la ligne redevient `pending`, replanifiée à
 *    `prochaineVerification`, l'action reste `scheduled` et l'inscription n'est PAS touchée
 *    (`current_step` est déjà avancé par le tick, `next_action_at` reste nul : rien ne la rejoue).
 *    `attempts` rend la tentative, pour qu'une attente de plusieurs jours n'épuise pas le budget
 *    des échecs de lecture (`remettreActionEnAttente`).
 *  - Passé ce délai : la ligne est `cancelled / invitation_non_acceptee`, l'action `skipped` avec le
 *    même motif, et l'échéance de l'étape suivante est posée comme au départ réel (même fonction,
 *    donc même invariant sur `current_step`, y compris après un rejeu).
 *
 * Le délai n'est jugé QU'APRÈS une vérification réelle : une personne invitée il y a longtemps
 * dans une autre campagne est d'abord essayée, elle a pu accepter depuis.
 *
 * Tout dans une transaction, sur une ligne verrouillée encore `processing` : une personne sortie
 * entre-temps (ligne annulée par `annulerEnvoisEnFile`, action écartée) n'est ni replanifiée ni avancée.
 */
export async function reglerMessagePasEncoreRelation(
  ex: Executeur,
  entree: EntreeMessagePasEncoreRelation,
): Promise<SortieMessagePasEncoreRelation> {
  const jours = await plafondDuJour(ex, entree.organizationId, 'linkedin_attente_acceptation_jours');
  return dansUneTransaction(ex, async (tx): Promise<SortieMessagePasEncoreRelation> => {
    const lue = await tx.query<{
      action_id: string;
      contact_id: string | null;
      arrivee_le: string | Date;
      invitation_le: string | Date | null;
    }>(
      `select q.action_id, q.contact_id, q.created_at as arrivee_le,
              (select max(i.sent_at) from linkedin_action_queue i
                where i.organization_id = q.organization_id and i.contact_id = q.contact_id
                  and i.kind = 'invite' and i.status = 'sent') as invitation_le /* jr:linkedin_attente_lecture */
         from linkedin_action_queue q
         join actions a on a.id = q.action_id and a.organization_id = q.organization_id
        where q.id = $1 and q.organization_id = $2 and q.status = 'processing'
          and q.kind = 'message' and q.origine = 'sequence'
          and a.channel = 'linkedin_message' and a.status in ('scheduled', 'approved')
        for update of q`,
      [entree.queueId, entree.organizationId],
    );
    const ligne = lue.rows[0];
    if (!ligne) return { issue: 'sans_sequence' };

    const depuis = new Date(versInstant(ligne.invitation_le ?? ligne.arrivee_le) ?? entree.maintenant.getTime());
    const echeance = depuis.getTime() + jours * 24 * 3_600_000;

    if (entree.maintenant.getTime() < echeance) {
      await tx.query(
        `update linkedin_action_queue /* jr:linkedin_attente_replanifier */
            set status = 'pending', scheduled_for = $3, attempts = greatest(attempts - 1, 0),
                error_code = $4, error_message = $5, processing_started_at = null, updated_at = now()
          where id = $1 and organization_id = $2 and status = 'processing'`,
        [
          entree.queueId,
          entree.organizationId,
          entree.prochaineVerification.toISOString(),
          CODE_ATTENTE_ACCEPTATION,
          MESSAGE_ATTENTE_ACCEPTATION,
        ],
      );
      return { issue: 'en_attente', jours };
    }

    await tx.query(
      `update linkedin_action_queue /* jr:linkedin_attente_sauter_file */
          set status = 'cancelled', error_code = $3, error_message = $4, updated_at = now()
        where id = $1 and organization_id = $2 and status = 'processing'`,
      [entree.queueId, entree.organizationId, CODE_INVITATION_NON_ACCEPTEE, messageInvitationNonAcceptee(jours)],
    );
    const sautee = await tx.query(
      `update actions set status = 'skipped', error = $3 /* jr:linkedin_attente_sauter_action */
        where id = $1 and organization_id = $2 and status in ('scheduled', 'approved')`,
      [ligne.action_id, entree.organizationId, CODE_INVITATION_NON_ACCEPTEE],
    );
    // Même geste qu'au départ réel : l'étape suivante devient due `delay_hours` après CE moment.
    if ((sautee.rowCount ?? 0) > 0) await poserEcheanceApresDepartDepuisAction(tx, ligne.action_id, entree.maintenant);
    return { issue: 'saute', jours, contactId: ligne.contact_id };
  });
}

/** Texte écrit sur la ligne de file qui attend : lisible, jamais un extrait de réponse LinkedIn. */
export const MESSAGE_ATTENTE_ACCEPTATION =
  'La personne n’a pas encore accepté l’invitation : le message attend, avec une vérification par jour.';

/** Texte écrit quand le délai est écoulé : il nomme la durée réglée. */
export function messageInvitationNonAcceptee(jours: number): string {
  return `L’invitation n’a pas été acceptée en ${jours} jours : le message est passé, la séquence continue.`;
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

export type MotifAucunEnvoi = MotifRefus | 'action_en_cours' | 'file_vide' | 'plafond_horaire_atteint';

/**
 * Requêtes qu'un envoi peut coûter à LinkedIn (lecture du profil, envoi, traces) : sous ce reste de
 * budget horaire on attend plutôt que d'en laisser une moitié partir. UNE seule valeur pour le
 * handler d'envoi (qui refuse le tour) et pour `prochainEnvoiLinkedIn` (qui annonce le refus) :
 * deux jugements sur le même fait feraient promettre à l'écran un envoi que le worker jette.
 */
export const REQUETES_PAR_ENVOI = 4;
const UNE_HEURE_MS = 3_600_000;

/**
 * Le budget de requêtes de l'heure écoulée (plafond `linkedin_requetes_par_heure`, partagé avec la
 * collecte : même table, même fenêtre glissante). Quand il manque, la date où il se libère se
 * CALCULE : il faut que les `aLiberer` requêtes les plus anciennes de la fenêtre en sortent, donc
 * la date de la dernière d'entre elles plus une heure (et une milliseconde : la fenêtre du
 * handler est `>=`, une requête posée à l'instant T compte encore à T + 1 h). `null` quand elle
 * ne se libérera jamais (plafond réglé sous le coût d'un envoi) : aucune date n'est inventée.
 */
async function budgetHoraire(
  ex: Executeur,
  organisationId: string,
  maintenant: Date,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly libereA: Date | null }> {
  const plafond = await plafondDuJour(ex, organisationId, 'linkedin_requetes_par_heure');
  const depuis = new Date(maintenant.getTime() - UNE_HEURE_MS);
  const deLHeure = await compterRequetesLinkedIn({ ex, organisationId }, depuis);
  if (plafond - deLHeure >= REQUETES_PAR_ENVOI) return { ok: true };
  if (plafond < REQUETES_PAR_ENVOI) return { ok: false, libereA: null };

  const aLiberer = deLHeure - (plafond - REQUETES_PAR_ENVOI);
  const res = await ex.query<{ requested_at: string | Date }>(
    `select requested_at from linkedin_requetes /* jr:linkedin_budget_horaire_liberation */
      where organization_id = $1 and requested_at >= $2
      order by requested_at asc offset $3 limit 1`,
    [organisationId, depuis.toISOString(), aLiberer - 1],
  );
  const dernierePartie = res.rows[0]?.requested_at;
  return {
    ok: false,
    libereA: dernierePartie ? new Date(new Date(versIso(dernierePartie)).getTime() + UNE_HEURE_MS + 1) : null,
  };
}

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
  | { readonly quand: Date; readonly motif: null; readonly raison: 'envoi' | 'reparation'; readonly disponibleA?: undefined }
  /**
   * `disponibleA` : seulement quand le refus se lève à une date CALCULÉE (budget horaire) ; absent
   * pour tous les autres, qui ne se lèvent pas à une échéance connue.
   */
  | { readonly quand: null; readonly motif: MotifAucunEnvoi; readonly disponibleA?: Date };

/**
 * Le moment où un envoi serveur redevient possible pour une organisation, ou `null` quand
 * aucun ne l'est. LECTURE SEULE, sans navigateur : elle sert à dater le job d'envoi plutôt
 * qu'à réveiller le worker toutes les minutes pour que la réclamation réponde « pas encore ».
 *
 * Elle juge avec les mêmes règles que `reclamerProchaineAction` (`jugerRythme`), et ne
 * rend une date que pour ce qui se lève à une échéance connue :
 *  - tout est prêt : maintenant ;
 *  - l'intervalle irrégulier de 1 à 20 minutes n'est pas écoulé : la minute où il le sera ;
 *  - budget de requêtes de l'heure épuisé (`plafond_horaire_atteint`) : `null` et, quand elle se
 *    calcule, la date où le budget se libère (`disponibleA`) ;
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

  // Une réponse de l'opérateur dont le sort n'est pas écrit : seul le handler la règle (balayage).
  if (await existeReponseSansSort(ex, organisationId)) {
    return { quand: maintenant, motif: null, raison: 'reparation' };
  }

  // Chaque type a son plafond : on juge la plus ancienne de chacun, et un seul qui passe suffit.
  const candidates = await prochainesCandidates(ex, organisationId, maintenant);
  if (candidates.length === 0) {
    return { quand: null, motif: 'file_vide' };
  }

  const { verdict } = jugerCandidates(candidates, await chargerStatsRythme(ex, organisationId, maintenant), maintenant);
  let quand: Date;
  if (verdict.ok) {
    quand = maintenant;
  } else if (verdict.motif === 'too_soon' && verdict.attendreMinutes !== undefined) {
    quand = new Date(maintenant.getTime() + verdict.attendreMinutes * 60_000);
  } else {
    return { quand: null, motif: verdict.motif };
  }

  // Le handler refuse le tour quand le budget de l'heure est épuisé : l'annoncer ici, sinon l'écran
  // dit « prêt » pendant que chaque job est jeté.
  const horaire = await budgetHoraire(ex, organisationId, maintenant);
  if (!horaire.ok) {
    if (!horaire.libereA) return { quand: null, motif: 'plafond_horaire_atteint' };
    // Les deux conditions doivent être levées : l'intervalle irrégulier ET le budget.
    const disponibleA = horaire.libereA.getTime() > quand.getTime() ? horaire.libereA : quand;
    return { quand: null, motif: 'plafond_horaire_atteint', disponibleA };
  }
  return { quand, motif: null, raison: 'envoi' };
}

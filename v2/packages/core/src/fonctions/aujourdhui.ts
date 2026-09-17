/**
 * Vue d'ensemble « Aujourd'hui » : ce qu'un opérateur doit savoir en ouvrant
 * l'app (réponses à traiter, file du jour, moteur, plafonds, campagnes,
 * alertes). Une seule fonction, lue par l'écran comme par la coquille comme
 * par le futur serveur MCP (spec « une fonction, deux façades »).
 */
import type { Contexte } from './contexte.js';
import { exiger } from './contexte.js';
import { lireConsommationDuJour, lireReglages } from './plafonds.js';
import { lireEtatMoteur, type EtatMoteurResume } from './moteur.js';
import { SQL_PROVIDER_ID_AFFICHAGE } from './sources.js';
import { SQL_CONDITION_A_TRAITER } from './reception.js';
import { versInstant } from '../temps.js';

/** `undefined` pour un canal qui n'a pas de pastille dans le kit (courrier, appel) — pas de repli sur email. */
export type CanalFil = 'email' | 'linkedin' | undefined;
export type ClassificationFil = 'human_reply' | 'auto_absence' | 'auto_left_company' | 'auto_other' | 'unclassified';

export interface FilResume {
  id: string;
  contactNom: string;
  poste: string | null;
  entreprise: string | null;
  extrait: string;
  quand: string | null;
  canal: CanalFil;
  classification: ClassificationFil;
}

/** État détaillé d'un envoi — miroir de `action_status` (base). */
export type EtatEnvoi =
  | 'scheduled'
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  | 'delivered'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped';

export interface EnvoiPrevu {
  id: string;
  heure: string | null;
  envoye: boolean;
  contactNom: string;
  etape: number | null;
  campagneNom: string | null;
  expediteur: string | null;
  canal: CanalFil;
  /**
   * Champs supplémentaires posés par la tâche 10 (onglet File du jour d'une
   * campagne, `campagnes.ts::listerFileDuJour`) : tous optionnels et absents
   * de la page Aujourd'hui (`lireAujourdhui`, cette même page), qui ne les
   * lit pas et dont les tests restent inchangés.
   */
  etatDetaille?: EtatEnvoi;
  /** Objet du message, quand il est connu à moindre coût (déjà stocké après un envoi réussi) — `null`/absent sinon, pas re-rendu ici. */
  objet?: string | null;
  contactId?: string | null;
  expediteurId?: string | null;
  /** Signal d'origine du contact — sert au bouton « Chercher l'email » d'un envoi bloqué faute d'adresse. */
  signalId?: string | null;
  /** `block_reason` ou `error` de l'action, selon celui qui est renseigné. */
  raisonEchec?: string | null;
}

export interface CampagneResume {
  id: string;
  nom: string;
  statut: 'draft' | 'active' | 'paused' | 'archived';
  etapes: number;
  boites: number;
  /** Un élément peut être `null` (R70, tour de correction 4) : aucun des trois repères de fournisseur n'a de valeur. */
  sources: (string | null)[];
  qualifies: number;
  enSequence: number;
  reponses: number;
  tauxReponse: number;
}

export type TypeAlerte = 'pause_envoi' | 'boite_deconnectee' | 'fournisseur_sans_cle' | 'source_orpheline' | 'moteur_silencieux';

export interface Alerte {
  type: TypeAlerte;
  texte: string;
  lien: string;
}

export interface Aujourdhui {
  aTraiter: { total: number; fils: FilResume[] };
  fileDuJour: { total: number; dejaPartis: number; derniereHeure: string | null; envois: EnvoiPrevu[] };
  moteur: EtatMoteurResume;
  plafonds: Awaited<ReturnType<typeof lireConsommationDuJour>>;
  campagnes: CampagneResume[];
  alertes: Alerte[];
}

/** Taille de l'aperçu affiché sur l'écran (le total, lui, porte toujours le compte réel). */
const NOMBRE_FILS_APERCU = 4;
const NOMBRE_ENVOIS_APERCU = 6;

interface LigneFil {
  id: string;
  channel: string;
  classification: ClassificationFil;
  /** `threads.last_message_at`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne. */
  last_message_at: string | Date | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  account_name: string | null;
  dernier_message: string | null;
}

interface LigneAction {
  id: string;
  status: string;
  /** `actions.dispatched_at`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne. */
  dispatched_at: string | Date | null;
  scheduled_for: string | null;
  dispatch_after: string | null;
  channel: string;
  first_name: string | null;
  last_name: string | null;
  campagne_nom: string | null;
  etape: number | null;
  expediteur: string | null;
}

interface LigneCampagne {
  id: string;
  name: string;
  status: CampagneResume['statut'];
  etapes: number;
  boites: number;
  sources: (string | null)[] | null;
  qualifies: number;
  en_sequence: number;
  reponses: number;
}

/** Pas de pastille pour `letter`/`call` (le kit n'en a pas) — `undefined`, jamais un repli sur email. */
function canalDe(channel: string): CanalFil {
  if (channel.startsWith('linkedin')) return 'linkedin';
  if (channel === 'email') return 'email';
  return undefined;
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

// `new Date(iso)` accepte indifféremment une chaîne ISO ou un objet `Date` (le
// constructeur traite spécialement un `Date` en argument) : accepter les deux
// ici évite un cast quand l'appelant tient encore un horodatage `pg` brut.
function formatterHeure(iso: string | Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export async function lireAujourdhui(ctx: Contexte): Promise<Aujourdhui> {
  exiger(ctx, 'viewer');
  // Lus d'abord, seuls : `lireConsommationDuJour` en a besoin aussi (fuseau,
  // plafonds), et lui repasser ceux-ci lui évite de relire lui-même
  // `organization_settings` une seconde fois dans le même appel.
  const reglages = await lireReglages(ctx);
  const [filsRes, actionsRes, campagnesRes, orphelinesRes, organisationRes, boitesDeconnecteesRes, moteur, plafonds] = await Promise.all([
    ctx.ex.query<LigneFil>(
      `select t.id, t.channel, t.classification, t.last_message_at,
              c.first_name, c.last_name, c.job_title, ac.name as account_name,
              (select m.body from thread_messages m where m.thread_id = t.id order by m.sent_at desc nulls last limit 1) as dernier_message
         from threads t /* jr:threads_a_traiter */
         left join contacts c on c.id = t.contact_id
         left join accounts ac on ac.id = c.account_id
        where t.organization_id = $1
          and ${SQL_CONDITION_A_TRAITER}
        order by t.last_message_at desc nulls last`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneAction>(
      `select a.id, a.status, a.dispatched_at, a.scheduled_for, a.dispatch_after, a.channel,
              c.first_name, c.last_name, camp.name as campagne_nom, st.position as etape, s.identity as expediteur
         from actions a /* jr:file_du_jour */
         join enrollments e on e.id = a.enrollment_id
         left join contacts c on c.id = e.contact_id
         left join campaigns camp on camp.id = e.campaign_id
         left join sequence_steps st on st.id = a.step_id
         left join senders s on s.id = a.sender_id
        where a.organization_id = $1
          and a.status <> 'cancelled'
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) >= date_trunc('day', now())
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) < date_trunc('day', now()) + interval '1 day'
        order by coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) asc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneCampagne>(
      `select c.id, c.name, c.status,
              (select count(*)::int from sequence_steps ss where ss.campaign_id = c.id) as etapes,
              (select count(*)::int from senders sd where sd.organization_id = c.organization_id and sd.kind = 'email' and sd.is_active) as boites,
              coalesce((select array_agg(distinct ${SQL_PROVIDER_ID_AFFICHAGE}) from campaign_sources cs join sources so on so.id = cs.source_id where cs.campaign_id = c.id), '{}') as sources,
              (select count(*)::int from enrollments e where e.campaign_id = c.id) as qualifies,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'active') as en_sequence,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'replied') as reponses
         from campaigns c /* jr:campagnes_resume */
        where c.organization_id = $1
        order by c.created_at desc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:sources_orphelines */
         from sources s
        where s.organization_id = $1
          and s.is_active
          and not exists (select 1 from campaign_sources cs where cs.source_id = s.id)`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ sending_paused_at: string | null; sending_paused_reason: string | null }>(
      `select sending_paused_at, sending_paused_reason /* jr:pause_envoi */
         from organizations
        where id = $1`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ identity: string }>(
      // `sending_enabled` est le champ mémoïsé lu par le handler d'envoi lui-même
      // (`apps/worker/src/handlers/email-salesblink.ts`) — le migrer vers un autre
      // champ de `provider_state` désynchroniserait cette alerte du vrai blocage.
      `select identity /* jr:boites_deconnectees */
         from senders
        where organization_id = $1
          and kind = 'email'
          and is_active
          and provider_state->>'sending_enabled' = 'false'`,
      [ctx.organisationId],
    ),
    lireEtatMoteur(ctx),
    lireConsommationDuJour(ctx, reglages),
  ]);

  const fuseau = String(reglages.fuseau);

  const fils: FilResume[] = filsRes.rows.map((r) => ({
    id: r.id,
    contactNom: nomComplet(r.first_name, r.last_name),
    poste: r.job_title,
    entreprise: r.account_name,
    extrait: r.dernier_message ?? '',
    // Forme publique honnête (`FilResume.quand: string | null`) : jamais l'objet `Date` tel quel.
    quand: r.last_message_at === null ? null : new Date(r.last_message_at).toISOString(),
    canal: canalDe(r.channel),
    classification: r.classification,
  }));

  const envois: EnvoiPrevu[] = actionsRes.rows.map((r) => {
    const quand = r.dispatched_at ?? r.scheduled_for ?? r.dispatch_after;
    return {
      id: r.id,
      heure: quand ? formatterHeure(quand, fuseau) : null,
      envoye: r.dispatched_at !== null,
      contactNom: nomComplet(r.first_name, r.last_name),
      // `sequence_steps.position` part de 0 (première étape = 0, voir la même
      // conversion dans `apps/web/app/actions/campaigns.ts`) : +1 pour l'humain.
      etape: r.etape !== null ? r.etape + 1 : null,
      campagneNom: r.campagne_nom,
      expediteur: r.expediteur,
      canal: canalDe(r.channel),
    };
  });
  const dejaPartis = actionsRes.rows.filter((r) => r.dispatched_at !== null).length;
  // `dispatched_at` (`timestamptz`) peut être un objet `Date` (pilote `pg`) : un
  // `.sort()` par défaut le compare via `Date.prototype.toString()`
  // (« Thu Sep 17 2026 … »), lexicographiquement faux (un jeudi passerait
  // devant un mardi pourtant plus récent). `versInstant` compare l'instant
  // réel ; la valeur publique reste une chaîne ISO.
  let derniereEnvoyeeMs: number | null = null;
  for (const r of actionsRes.rows) {
    const instant = versInstant(r.dispatched_at);
    if (instant !== null && (derniereEnvoyeeMs === null || instant > derniereEnvoyeeMs)) {
      derniereEnvoyeeMs = instant;
    }
  }
  const derniereEnvoyee = derniereEnvoyeeMs !== null ? new Date(derniereEnvoyeeMs).toISOString() : null;

  const campagnes: CampagneResume[] = campagnesRes.rows.map((r) => ({
    id: r.id,
    nom: r.name,
    statut: r.status,
    etapes: r.etapes,
    boites: r.boites,
    sources: r.sources ?? [],
    qualifies: r.qualifies,
    enSequence: r.en_sequence,
    reponses: r.reponses,
    tauxReponse: r.qualifies > 0 ? Math.round((r.reponses / r.qualifies) * 1000) / 10 : 0,
  }));

  const alertes: Alerte[] = [];
  if (!moteur.enMarche) {
    alertes.push({
      type: 'moteur_silencieux',
      texte: moteur.dernierPassage
        ? `Le moteur n'a pas donné signe de vie depuis plus de 15 minutes (dernier passage à ${formatterHeure(moteur.dernierPassage, fuseau)}).`
        : "Le moteur n'a jamais tourné sur cette instance.",
      lien: '/',
    });
  }
  const nbOrphelines = orphelinesRes.rows[0]?.n ?? 0;
  if (nbOrphelines > 0) {
    alertes.push({
      type: 'source_orpheline',
      texte:
        nbOrphelines === 1
          ? "Une source active n'alimente aucune campagne."
          : `${nbOrphelines} sources actives n'alimentent aucune campagne.`,
      lien: '/campaigns',
    });
  }
  const organisation = organisationRes.rows[0];
  if (organisation?.sending_paused_at) {
    const heurePause = formatterHeure(organisation.sending_paused_at, fuseau);
    alertes.push({
      type: 'pause_envoi',
      texte: organisation.sending_paused_reason
        ? `Les envois sont en pause depuis ${heurePause} : ${organisation.sending_paused_reason}.`
        : `Les envois sont en pause depuis ${heurePause}.`,
      // Route de la tâche 23 (réglages du moteur), pas encore construite.
      lien: '/settings/engine',
    });
  }
  for (const boite of boitesDeconnecteesRes.rows) {
    alertes.push({
      type: 'boite_deconnectee',
      texte: `La boîte ${boite.identity} est déconnectée : elle n'envoie plus.`,
      lien: '/settings/senders',
    });
  }

  return {
    aTraiter: { total: fils.length, fils: fils.slice(0, NOMBRE_FILS_APERCU) },
    fileDuJour: {
      total: envois.length,
      dejaPartis,
      derniereHeure: derniereEnvoyee ? formatterHeure(derniereEnvoyee, fuseau) : null,
      envois: envois.slice(0, NOMBRE_ENVOIS_APERCU),
    },
    moteur,
    plafonds,
    campagnes,
    alertes,
  };
}

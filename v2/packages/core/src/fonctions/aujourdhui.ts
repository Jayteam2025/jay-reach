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
// `sqlContactsCampagne`/`tauxSurPartis` viennent de `campagnes.ts` (point 1, même définition
// partout) : le seul import que `campagnes.ts` fait de ce fichier (`EnvoiPrevu`, `CanalFil`) est
// un `import type`, effacé à la compilation — aucun cycle réel entre les deux modules (revue F5,
// constat important 2). Une copie locale identique n'était donc pas justifiée.
import {
  lireContraintesSendersDuJour,
  projeterEnvoisDuJour,
  sqlContactsCampagne,
  sqlListeSourceResumeCampagne,
  tauxSurPartis,
} from './campagnes.js';

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
  /**
   * `dispatched_at` renseigné — l'action a été REMISE (au transporteur email,
   * SalesBlink, ou pour LinkedIn à la file de l'extension). Sert au calcul de
   * quota (`projeterEnvoisDuJour` : une place déjà remise n'est plus « à
   * distribuer aujourd'hui »), PAS à dire si le message est réellement parti
   * — voir `livre` (F12) pour ça. Ne pas renommer sans vérifier ce calcul.
   */
  envoye: boolean;
  /**
   * Départ RÉEL du message (F12) : pour un email, seulement une fois
   * SalesBlink l'a effectivement envoyé (`delivered_at`), jamais la simple
   * remise au transporteur (`envoye`) qui part ensuite dans SA fenêtre
   * horaire à elle — un envoi remis à 4h peut ne partir qu'à 9h. Pour les
   * autres canaux (LinkedIn : `dispatched_at` posé par l'extension au moment
   * réel de l'action, aucun transporteur asynchrone entre les deux), `envoye`
   * EST déjà ce départ réel.
   */
  livre: boolean;
  contactNom: string;
  etape: number | null;
  campagneNom: string | null;
  expediteur: string | null;
  canal: CanalFil;
  /**
   * Champs supplémentaires posés par la tâche 10 (onglet File du jour d'une
   * campagne, `campagnes.ts::listerFileDuJour`) : optionnels et absents de
   * `lireAujourdhui` (cette même page), qui ne les lit pas et dont les tests
   * restent inchangés — SAUF `expediteurId`, posé aussi par `lireAujourdhui`
   * depuis la revue F5 (point 10) : c'est lui qui rattache un envoi pas
   * encore parti à sa boîte pour `projeterEnvoisDuJour`.
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
  /**
   * Point 1 (tour de correction 5) : remplace l'ancienne colonne « Qualifiés »
   * (qui comptait TOUTES les inscriptions, même terminées — jamais le même
   * nombre que l'onglet Contacts). Même définition que `CampagneListeResume.contacts`
   * (`campagnes.ts`) : personnes distinctes de la population de la campagne.
   */
  contacts: number;
  enSequence: number;
  reponses: number;
  /** Réponses / emails partis (`dispatched`+`delivered`), jamais / en séquence ni / contacts (point 1) — `null` (page : « — ») sans envoi. */
  tauxReponse: number | null;
  /**
   * Liste qui alimente la campagne (point 2, issue #120 ; revue F5, point 1)
   * — `null` pour une campagne à sources. Remplace « aucune source » quand la
   * campagne n'a ni thème de veille ni liste au niveau de `campaigns` mais
   * puise dans une liste via ses inscriptions.
   */
  listeSource: { nom: string; autresListes: number } | null;
}

export type TypeAlerte = 'pause_envoi' | 'boite_deconnectee' | 'fournisseur_sans_cle' | 'source_orpheline' | 'moteur_silencieux';

export interface Alerte {
  type: TypeAlerte;
  texte: string;
  lien: string;
}

export interface Aujourdhui {
  aTraiter: { total: number; fils: FilResume[] };
  fileDuJour: {
    /** Actions remises ou planifiées aujourd'hui (dans le fuseau de l'organisation), quel que soit leur départ réel. */
    total: number;
    /**
     * « Partis » (F12) : messages RÉELLEMENT envoyés aujourd'hui (dans le
     * fuseau de l'organisation) — `livre` de chaque envoi, PAS `envoye`
     * (simple remise au transporteur). Compte cross-jour (revue F12) : un
     * message remis hier mais parti aujourd'hui compte ici, un message remis
     * aujourd'hui mais pas encore parti n'y compte pas encore — voir `enFile`.
     * N'est donc PAS un sous-ensemble de `envois`/`total` (qui ne portent que
     * ce qui a été remis ou planifié AUJOURD'HUI), aucune relation arithmétique
     * simple entre les deux depuis ce correctif.
     */
    dejaPartis: number;
    /**
     * « En file » (F12) : parmi les actions de `total`, celles pas encore
     * RÉELLEMENT parties (`livre` faux) — remises au transporteur en attente
     * de départ, ou encore simplement planifiées.
     */
    enFile: number;
    /**
     * Parmi les envois pas encore remis (`envoye` faux), combien peuvent
     * RÉELLEMENT encore sortir aujourd'hui compte tenu du plafond journalier
     * restant de leur boîte (revue F5, point 10, `projeterEnvoisDuJour`) —
     * `possiblesAujourdhui + reportesProchainCreneau === total - (nombre
     * d'envois de `envois` avec `envoye` vrai)`.
     */
    possiblesAujourdhui: number;
    /** Devraient logiquement partir aujourd'hui (même jour calendaire) mais leur boîte aura déjà atteint son plafond avant d'y arriver — reportés à demain par le moteur lui-même au moment de l'envoi. */
    reportesProchainCreneau: number;
    derniereHeure: string | null;
    envois: EnvoiPrevu[];
  };
  moteur: EtatMoteurResume;
  plafonds: Awaited<ReturnType<typeof lireConsommationDuJour>>;
  campagnes: CampagneResume[];
  alertes: Alerte[];
  /**
   * Fuseau de l'organisation (correctif du 18/09) — déjà lu ci-dessous pour `jourRef`/`formatterHeure`,
   * exposé ici pour que la coquille et la page Aujourd'hui (`apps/web`, toutes deux mémoïsées sur
   * le même appel via `lireAujourdhuiCourant`) formatent « Dernier/prochain passage » du moteur
   * dans ce fuseau sans relire `organization_settings` une seconde fois : `moteur.dernierPassage`/
   * `prochainPassage` restent des ISO bruts (R30, pas reformatés ici, seul le texte de l'alerte
   * `moteur_silencieux` l'est) — c'est au web de les formater, il lui fallait juste le fuseau.
   */
  fuseau: string;
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
  /** `actions.delivered_at` (F12), même remarque `pg` que `dispatched_at` — `null` tant que non réellement parti (ou canal non email). */
  delivered_at: string | Date | null;
  scheduled_for: string | null;
  dispatch_after: string | null;
  channel: string;
  sender_id: string | null;
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
  contacts: number;
  en_sequence: number;
  partis: number;
  reponses: number;
  /** `sqlListeSourceResumeCampagne` (revue F5, point 1) — `null` pour une campagne à sources. */
  liste_source: { nom: string; autres: number } | null;
}

/** Pas de pastille pour `letter`/`call` (le kit n'en a pas) — `undefined`, jamais un repli sur email. */
function canalDe(channel: string): CanalFil {
  if (channel.startsWith('linkedin')) return 'linkedin';
  if (channel === 'email') return 'email';
  return undefined;
}

/**
 * Départ RÉEL d'une action (F12) — voir `EnvoiPrevu.livre`. Un email n'est
 * réellement parti qu'une fois SalesBlink l'a effectivement envoyé
 * (`delivered_at`) ; les autres canaux (LinkedIn : posé par l'extension au
 * moment réel de l'action, `apps/web/lib/linkedin/queue.ts`) n'ont pas de
 * transporteur asynchrone entre remise et départ — `dispatched_at` EST déjà
 * ce départ réel pour eux.
 */
function estReellementParti(channel: string, dispatchedAt: unknown, deliveredAt: unknown): boolean {
  // `!= null` (lâche) plutôt que `!== null` : couvre `undefined` comme `null`, au cas où un
  // appelant (test compris) omet la colonne plutôt que de la poser explicitement à `null`.
  return channel === 'email' ? deliveredAt != null : dispatchedAt != null;
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

/**
 * Jour calendaire dans un fuseau donné, pas celui du process qui exécute le rendu (I5, revue
 * finale — copie locale de `cleJourDansFuseau`, `apps/web/lib/dates.ts`, même convention que
 * `campagnes.ts`/`sources.ts` : pas de couplage cross-paquet pour un utilitaire d'une ligne).
 * `fr-CA` rend l'ISO (année-mois-jour) quel que soit l'environnement.
 */
function jourDansFuseau(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
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
  const fuseau = String(reglages.fuseau);
  // Jour calendaire dans le fuseau de l'organisation, pas celui du serveur UTC qui exécute le
  // rendu (même règle que `campagnes.ts::lireEnvoisDuJour`, R53) : la file du jour classait
  // sinon un envoi tardif ou matinal dans le mauvais jour près du changement de fuseau.
  const jourRef = jourDansFuseau(new Date(), fuseau);
  const [filsRes, actionsRes, partisAujourdhuiRes, campagnesRes, orphelinesRes, organisationRes, boitesDeconnecteesRes, moteur, plafonds, contraintesParSender] = await Promise.all([
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
      `select a.id, a.status, a.dispatched_at, a.delivered_at, a.scheduled_for, a.dispatch_after, a.channel, a.sender_id,
              c.first_name, c.last_name, camp.name as campagne_nom, st.position as etape, s.identity as expediteur
         from actions a /* jr:file_du_jour */
         join enrollments e on e.id = a.enrollment_id
         left join contacts c on c.id = e.contact_id
         left join campaigns camp on camp.id = e.campaign_id
         left join sequence_steps st on st.id = a.step_id
         left join senders s on s.id = a.sender_id
        where a.organization_id = $1
          and a.status <> 'cancelled'
          -- Le cast ::date::timestamp avant AT TIME ZONE est nécessaire : sans lui (un ::date
          -- suivi directement de AT TIME ZONE), Postgres résout le mauvais opérateur (celui de
          -- timestamptz, pas celui de timestamp) et repart du fuseau de LA SESSION au lieu de
          -- traiter $2 comme un jour local à $3, mesuré sur la base OSS le 18/09 : minuit Paris
          -- rendu comme 2h ou 4h du matin selon le sens de la comparaison, un comptage du jour
          -- qui ratait la quasi-totalité des lignes.
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) >= ($2::date::timestamp at time zone $3)
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) < (($2::date + 1)::timestamp at time zone $3)
        order by coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) asc`,
      [ctx.organisationId, jourRef, fuseau],
    ),
    // « Partis » (F12) : combien de messages sont RÉELLEMENT partis aujourd'hui, dans le fuseau
    // de l'organisation — cross-jour à dessein (un message REMIS hier mais parti aujourd'hui
    // compte ici), donc une requête à part de `jr:file_du_jour` ci-dessus, qui ne porte que ce
    // qui a été remis OU planifié aujourd'hui. Email : `delivered_at` (l'instant où SalesBlink
    // l'a réellement envoyé) ; autres canaux (LinkedIn) : `dispatched_at` est déjà cet instant
    // réel, aucun transporteur asynchrone entre les deux (voir `estReellementParti`).
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:partis_aujourdhui */
         from actions a
        where a.organization_id = $1
          and (
            -- Même remarque que ci-dessus sur ::date::timestamp at time zone (jamais
            -- ::date at time zone seul).
            (a.channel = 'email' and a.status = 'delivered'
               and a.delivered_at >= ($2::date::timestamp at time zone $3) and a.delivered_at < (($2::date + 1)::timestamp at time zone $3))
            or
            (a.channel <> 'email' and a.status in ('dispatched', 'delivered')
               and a.dispatched_at >= ($2::date::timestamp at time zone $3) and a.dispatched_at < (($2::date + 1)::timestamp at time zone $3))
          )`,
      [ctx.organisationId, jourRef, fuseau],
    ),
    ctx.ex.query<LigneCampagne>(
      `select c.id, c.name, c.status,
              (select count(*)::int from sequence_steps ss where ss.campaign_id = c.id) as etapes,
              (select count(*)::int from senders sd where sd.organization_id = c.organization_id and sd.kind = 'email' and sd.is_active) as boites,
              coalesce((select array_agg(distinct ${SQL_PROVIDER_ID_AFFICHAGE}) from campaign_sources cs join sources so on so.id = cs.source_id where cs.campaign_id = c.id), '{}') as sources,
              -- « Contacts » (point 1, tour de correction 5) : MÊME définition que
              -- CampagneListeResume.contacts, portée par campagnes.ts et importée ici
              -- (revue F5, constat important 2 : aucun cycle réel, le seul import de
              -- campagnes.ts vers ce fichier est un «import type», effacé à la
              -- compilation). Remplace l'ancienne colonne « Qualifiés » (tout
              -- l'historique des inscriptions), qui ne rendait jamais le même chiffre
              -- que l'onglet Contacts.
              ${sqlContactsCampagne('c.id')} as contacts,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'active') as en_sequence,
              (select count(*)::int from actions a join enrollments e on e.id = a.enrollment_id where e.campaign_id = c.id and a.status in ('dispatched', 'delivered')) as partis,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'replied') as reponses,
              ${sqlListeSourceResumeCampagne('c.id')} as liste_source
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
    lireEtatMoteur(ctx, reglages),
    lireConsommationDuJour(ctx, reglages),
    lireContraintesSendersDuJour(ctx, jourRef, fuseau),
  ]);

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
      livre: estReellementParti(r.channel, r.dispatched_at, r.delivered_at),
      contactNom: nomComplet(r.first_name, r.last_name),
      // `sequence_steps.position` part de 0 (première étape = 0, voir la même
      // conversion dans `apps/web/app/actions/campaigns.ts`) : +1 pour l'humain.
      etape: r.etape !== null ? r.etape + 1 : null,
      campagneNom: r.campagne_nom,
      expediteur: r.expediteur,
      expediteurId: r.sender_id,
      canal: canalDe(r.channel),
    };
  });
  // « Partis » (F12) : requête à part (`jr:partis_aujourdhui`), cross-jour à dessein — voir sa
  // définition ci-dessus et la doc de `Aujourdhui.fileDuJour.dejaPartis`.
  const dejaPartis = partisAujourdhuiRes.rows[0]?.n ?? 0;
  // « En file » (F12) : parmi les actions remises OU planifiées aujourd'hui (`envois`), celles
  // pas encore réellement parties — remises en attente de départ, ou simplement planifiées.
  const enFile = envois.filter((e) => !e.livre).length;
  // Revue F5, point 10 : combien des envois pas encore partis peuvent RÉELLEMENT encore
  // sortir aujourd'hui, compte tenu du plafond journalier restant de leur boîte — voir
  // `VueDEnsemble.projectionFileDuJour` (même calcul, même sens, campagnes.ts).
  const projectionFileDuJour = projeterEnvoisDuJour(envois.filter((e) => !e.envoye), contraintesParSender);
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
    contacts: r.contacts,
    enSequence: r.en_sequence,
    reponses: r.reponses,
    tauxReponse: tauxSurPartis(r.reponses, r.partis),
    listeSource: r.liste_source ? { nom: r.liste_source.nom, autresListes: r.liste_source.autres } : null,
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
      enFile,
      possiblesAujourdhui: projectionFileDuJour.possiblesAujourdhui,
      reportesProchainCreneau: projectionFileDuJour.reportesProchainCreneau,
      derniereHeure: derniereEnvoyee ? formatterHeure(derniereEnvoyee, fuseau) : null,
      envois: envois.slice(0, NOMBRE_ENVOIS_APERCU),
    },
    moteur,
    plafonds,
    campagnes,
    alertes,
    fuseau,
  };
}

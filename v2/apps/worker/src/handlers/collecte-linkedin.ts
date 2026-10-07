/**
 * Handler de la file `linkedin.collecte` (lot 4a, tâche 7).
 *
 * Il orchestre, il n'écrit aucun contact : chaque personne part chez
 * `enregistrerEngageur` (tâche 6), seule à connaître le chemin « personne ».
 *
 * Ordre imposé, et chacun de ces points a une raison :
 *  1. le canal doit être explicitement autorisé (`JAY_REACH_LINKEDIN`) ;
 *  2. la session doit être `active` — on relit son état AVANT toute requête, pas
 *     celui qu'on avait au moment d'enfiler le job ;
 *  3. la sortie se relève AVANT d'ouvrir LinkedIn : l'écho d'IP part d'une page
 *     neutre, la CSP de LinkedIn le bloquerait depuis ses propres pages ;
 *  4. le verrou se prend ensuite, pour qu'un second passage ne conduise pas le
 *     même navigateur ;
 *  5. les plafonds se calculent avant la première requête.
 *
 * La file est en `retryLimit: 0` (`queues.ts`) : rien de ce qui échoue ici n'est
 * rejoué tout seul. Un passage qui a fâché LinkedIn ne doit pas y retourner
 * automatiquement.
 *
 * Aucun secret, aucune URL de proxy dans un message : seuls le type d'erreur et
 * l'IP observée sont consignés.
 */
import { DatabaseError, type Pool } from 'pg';
import {
  bloquerSessionLinkedIn,
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  jourCourantDansFuseau,
  lireFuseauLinkedIn,
  lirePlafondLinkedIn,
  lireSessionLinkedIn,
  marquerCollecteLinkedIn,
  notifier,
  prendreVerrouLinkedIn,
  tracerRequeteLinkedIn,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { controlerSortie } from '../linkedin/controle-sortie.js';
import { ErreurCollecte, lireEngageurs, type Budget, type Friction } from '../linkedin/engageurs.js';
import { adresseDeduite, engageurSchema, enregistrerEngageur, type IssueEngageur } from './post-engagement.js';
import type { Pilote } from '../linkedin/navigateur.js';

/** Charge utile de la file. Le passage est ouvert par le producteur : c'est lui qui a décidé de collecter. */
export interface CollecteLinkedInJob {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly sourceRunId: string;
}

/** Tout ce que le handler touche hors base, injecté pour que le harnais Postgres puisse le jouer sans LinkedIn. */
export interface DependancesCollecte {
  readonly pool: Pool;
  readonly env: Record<string, string | undefined>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  pause(ms: number): Promise<void>;
}

/**
 * Durée du verrou LinkedIn. Elle DOIT rester sous `SOURCE_RUN_TIMEOUT_MIN`
 * (30 min, `db.ts`) : au-delà, un passage que `closeStaleSourceRuns` a déclaré
 * mort garderait encore son verrou et bloquerait tous les suivants. Dix minutes
 * couvrent largement le pire cas réel — soixante requêtes (le plafond horaire
 * par défaut) espacées de six secondes font six minutes.
 */
export const DUREE_VERROU_COLLECTE_MS = 10 * 60_000;

/** Fenêtre glissante du plafond horaire : la dernière heure, pas l'heure en cours. */
const UNE_HEURE_MS = 3_600_000;

export const MSG = {
  canal: 'Le canal LinkedIn serveur est désactivé (JAY_REACH_LINKEDIN).',
  session: 'La session LinkedIn n’est pas active : reconnectez le compte.',
  source: 'Cette source d’engageurs n’est reliée à aucune campagne active.',
  persona: 'La campagne porte plusieurs personas : choisissez celui de la source.',
  sortie: 'Le navigateur est sorti par une adresse inattendue : collecte annulée.',
  verrou: 'Un autre passage conduit déjà le navigateur LinkedIn.',
  navigateur: 'Le navigateur LinkedIn est injoignable : vérifiez le conteneur et sa configuration.',
  releve: 'Impossible de relever l’IP de sortie du navigateur : le proxy ne répond pas.',
  plafond_posts: 'Plafond de posts du jour atteint.',
  plafond_requetes: 'Plafond de requêtes de l’heure atteint.',
  plafond_personnes: 'Plafond de personnes par passage atteint : le reste du post n’a pas été enregistré.',
  defi: 'LinkedIn demande une vérification : collecte arrêtée.',
  cookie_refuse: 'LinkedIn a refusé la session : collecte arrêtée.',
  liste_vide: 'Le post annonce des réactions mais LinkedIn n’en livre aucune : collecte arrêtée.',
  post_introuvable: 'Post introuvable, supprimé ou privé : vérifiez l’adresse.',
} as const;

const TITRE_ARRET = 'Collecte LinkedIn arrêtée';

interface Bilan {
  requetes: number;
  vus: number;
  nouveaux: number;
  doublons: number;
  dejaEnCampagne: number;
  /** Profils que la réponse Voyager n'a pas renseignés assez pour être exploitables. */
  ignores: number;
  /** Personnes laissées de côté parce qu'elles figurent sur la liste de suppression : un fait qu'on peut avoir à démontrer. */
  opposes: number;
  /** Parmi les nouvelles, celles enregistrées sous une adresse déduite de l'URN (ni cherchable ni enrichissable). */
  adressesDeduites: number;
  /** Le passage s'est arrêté sur le plafond de personnes enregistrées par passage. */
  plafondPersonnes: boolean;
}

const bilanVierge = (): Bilan => ({
  requetes: 0,
  vus: 0,
  nouveaux: 0,
  doublons: 0,
  dejaEnCampagne: 0,
  ignores: 0,
  opposes: 0,
  adressesDeduites: 0,
  plafondPersonnes: false,
});

interface ConfigCollecte {
  readonly urlPost: string;
  readonly garder: string[];
  readonly campagne: { id: string; personaId: string };
}

/**
 * La source, sa campagne ACTIVE et le persona qui jugera les personnes.
 *
 * Même règle de résolution que le scoring (`score.ts`, `JOINTURE_PERSONA`) : le
 * persona que la source porte, à défaut l'unique persona de la campagne. Les
 * deux doivent s'accorder, sinon le contact serait créé avec un persona et jugé
 * avec la consigne d'un autre.
 *
 * `null` si rien ne correspond : source inconnue, d'un autre type, ou reliée à
 * aucune campagne active (une campagne en brouillon ne collecte pas).
 */
async function lireConfigCollecte(pool: Pool, job: CollecteLinkedInJob): Promise<ConfigCollecte | { erreur: string } | null> {
  const res = await pool.query<{
    config: Record<string, unknown> | null;
    campagne_id: string;
    personas: string[] | null;
  }>(
    `select so.config, c.id as campagne_id, /* jr:linkedin_collecte_source */
            case when jsonb_typeof(c.entry_rules -> 'personas') = 'array'
                 then array(select jsonb_array_elements_text(c.entry_rules -> 'personas'))
                 else null end as personas
       from sources so
       join campaign_sources cs on cs.source_id = so.id
       join campaigns c on c.id = cs.campaign_id
      where so.id = $2 and so.organization_id = $1
        and so.config->>'sourceType' = 'linkedin_post_engagers'
        and c.status = 'active'
      limit 1`,
    [job.organizationId, job.sourceId],
  );
  const ligne = res.rows[0];
  if (!ligne) return null;
  const config = ligne.config ?? {};
  const urlPost = typeof config.urlPost === 'string' ? config.urlPost.trim() : '';
  if (urlPost.length === 0) return { erreur: MSG.post_introuvable };
  const garder = Array.isArray(config.garder) ? config.garder.map((g) => String(g)) : [];
  const personas = ligne.personas ?? [];
  const brut = typeof config.personaId === 'string' && config.personaId.length > 0 ? config.personaId : null;
  const personaId = brut ?? (personas.length === 1 ? personas[0] : null);
  if (personaId === undefined || personaId === null) return { erreur: MSG.persona };
  return { urlPost, garder, campagne: { id: ligne.campagne_id, personaId } };
}

/**
 * Clôt le passage : statut, compteurs du journal (`source_runs`, migration de la
 * tâche 6 et migration du bilan) et sortie observée. `items_found`/`items_new`
 * reçoivent les mêmes nombres que `vus`/`nouveaux`, pour les lecteurs écrits pour
 * les connecteurs d'offres ; la carte d'une source LinkedIn, elle, lit les compteurs
 * et `error` eux-mêmes (`lireCartesSources`).
 *
 * Le filtre par organisation est explicite : le worker écrit avec la clé de
 * service, que la RLS ne borne pas.
 */
async function cloreCollecte(
  pool: Pool,
  job: CollecteLinkedInJob,
  etat: {
    statut: 'success' | 'error';
    erreur?: string | null;
    bilan?: Bilan;
    sortie?: Sortie | null;
    /**
     * Ce passage est-il un VERDICT sur l'état du compte LinkedIn et de sa sortie ?
     * Vrai quand on a réellement parlé au monde extérieur et que le résultat dit
     * quelque chose du compte : collecte réussie, relève de sortie ratée (proxy),
     * statut anormal, défi. Faux pour tout le reste — refus locaux, plafonds,
     * adresse de post invalide, et nos propres échecs de lecture.
     */
    verdictLinkedIn?: boolean;
  },
): Promise<void> {
  const b = etat.bilan ?? bilanVierge();
  await pool.query(
    `update source_runs sr /* jr:linkedin_collecte_clore */
        set finished_at = now(), status = $3, error = $4,
            items_found = $5, items_new = $6,
            requetes = $7, vus = $5, nouveaux = $6, doublons = $8, deja_en_campagne = $9,
            ip_sortie = $10, operateur_sortie = $11, verdict_linkedin = $12,
            ignores = $13, opposes = $14, adresses_deduites = $15, plafond_personnes_atteint = $16
      where sr.id = $2
        and sr.source_id in (select id from sources where organization_id = $1)`,
    [
      job.organizationId,
      job.sourceRunId,
      etat.statut,
      etat.erreur ?? null,
      b.vus,
      b.nouveaux,
      b.requetes,
      b.doublons,
      b.dejaEnCampagne,
      etat.sortie?.ip ?? null,
      etat.sortie?.operateur ?? null,
      etat.verdictLinkedIn ?? false,
      b.ignores,
      b.opposes,
      b.adressesDeduites,
      b.plafondPersonnes,
    ],
  );
}

/**
 * Disjoncteur : trois passages de suite qui n'aboutissent pas suspendent la
 * session, même sans défi explicite. On lit l'état des trois derniers passages
 * TERMINÉS des sources d'engageurs de l'organisation, celui qui vient de se
 * clore compris — pas un compteur séparé, qui pourrait diverger de ce que
 * l'écran Sources montre.
 *
 * Ne comptent que les passages qui portent un VERDICT (`verdict_linkedin`) :
 * ceux où l'on a réellement parlé au monde extérieur ET dont le résultat dit
 * quelque chose de l'état du compte. En sont exclus, délibérément :
 *  - les refus purement locaux — canal désactivé, session non active, campagne en
 *    brouillon, persona ambigu, verrou tenu, navigateur injoignable. Sans ce
 *    filtre, deux clics sur « Lancer la collecte » avec une campagne en brouillon
 *    suffisaient à faire disjoncter au premier vrai passage ;
 *  - les plafonds, qui n'émettent rien ;
 *  - **un post introuvable (404) et nos propres échecs de lecture**. La requête a
 *    abouti, LinkedIn a répondu normalement, rien n'expose le compte : bloquer la
 *    session imposerait à l'opérateur une reconnexion — l'opération la plus
 *    risquée du lot — qui ne corrigerait ni une adresse mal collée ni un bug de
 *    parseur. Le disjoncteur protège le COMPTE, pas notre code.
 *
 * Y entrent la collecte réussie (elle remet le compteur à zéro), la relève de
 * sortie ratée (proxy mort), le statut anormal et le défi. Un passage refermé par
 * `closeStaleSourceRuns` n'y entre pas : un worker tué est un incident
 * d'hébergement, et une reconnexion LinkedIn n'y répond pas. Évalué seulement
 * quand le passage courant a échoué sur une exception, jamais après un succès.
 *
 * **La fenêtre s'arrête à la dernière reconnexion** (`connected_at`, que
 * `activerSessionLinkedIn` repose à chaque fois). Sans cette borne, l'opérateur
 * reconnecte son compte — l'opération la plus risquée du lot — puis le premier
 * passage qui rate UNE fois retrouve les deux anciens échecs et rebloque la
 * session, avec un « Trop d'échecs d'affilée » qui est faux. Il tournerait en
 * boucle, en répétant l'action dangereuse sans comprendre.
 */
async function verifierDisjoncteur(ctx: Contexte, pool: Pool): Promise<void> {
  const res = await pool.query<{ status: string }>(
    `select sr.status /* jr:linkedin_collecte_derniers */
       from source_runs sr
       join sources so on so.id = sr.source_id
      where so.organization_id = $1
        and so.config->>'sourceType' = 'linkedin_post_engagers'
        and sr.finished_at is not null
        and sr.verdict_linkedin
        and sr.finished_at > coalesce(
              (select connected_at from linkedin_server_sessions where organization_id = $1),
              '-infinity'::timestamptz)
      order by sr.finished_at desc
      limit 3`,
    [ctx.organisationId],
  );
  if (res.rows.length === 3 && res.rows.every((r) => r.status === 'error')) {
    await bloquerSessionLinkedIn(ctx, 'disjoncteur');
  }
}

/**
 * Ce qu'il reste à dépenser.
 *
 * `compterPostsLinkedInDuJour` ne compte que les posts RÉELLEMENT ouverts chez
 * LinkedIn, pas les lignes de passage : le producteur en ouvre une par source dans
 * la même boucle, et `lancerCampagne` demande une collecte sur TOUTES les sources de
 * la campagne à chaque activation. Compter les lignes faisait lire « quatre passages
 * aujourd'hui » aux quatre passages d'un coup, qui se clôturaient tous à vide.
 */
async function calculerBudget(ctx: Contexte, sourceRunId: string): Promise<Budget & { personnesMax: number }> {
  const fuseau = await lireFuseauLinkedIn(ctx);
  const [plafondPosts, postsDuJour, plafondRequetes, requetesDeLHeure, personnesMax] = await Promise.all([
    lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour'),
    compterPostsLinkedInDuJour(ctx, jourCourantDansFuseau(fuseau), fuseau, sourceRunId),
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    // Fenêtre GLISSANTE : la dernière heure. Aucun calcul de jour, aucun fuseau
    // ici — un plafond horaire calé sur l'heure ronde laisserait passer deux
    // pleines charges à cheval sur la minute 59.
    compterRequetesLinkedIn(ctx, new Date(Date.now() - UNE_HEURE_MS)),
    lirePlafondLinkedIn(ctx, 'linkedin_personnes_par_passage'),
  ]);
  return {
    postsRestants: Math.max(0, plafondPosts - postsDuJour),
    requetesRestantes: Math.max(0, plafondRequetes - requetesDeLHeure),
    personnesMax,
  };
}

/** Friction : ce qu'on fait de la session, et ce qu'on écrit dans le passage. */
async function traiterFriction(ctx: Contexte, pool: Pool, friction: Friction): Promise<string> {
  const message = MSG[friction.type];
  if (friction.type === 'defi' || friction.type === 'cookie_refuse') {
    // `bloquerSessionLinkedIn` notifie lui-même, une seule fois par blocage.
    await bloquerSessionLinkedIn(ctx, friction.type);
  } else {
    // Session préservée : ce n'est pas LinkedIn qui nous conteste. Mais
    // l'opérateur a cliqué « Lancer la collecte » et doit apprendre pourquoi
    // rien n'est arrivé.
    await notifier(pool, ctx.organisationId, 'linkedin.collecte_arretee', TITRE_ARRET, message);
  }
  return message;
}

/**
 * Clôt un passage refusé AVANT toute requête LinkedIn, et le dit au journal du worker.
 *
 * Ces refus (canal absent, session non active, source sans campagne, persona ambigu, verrou
 * tenu, plafonds) n'envoient aucune notification : l'écran Sources les lit dans `source_runs.error`,
 * le journal sert au diagnostic à distance sur le VPS. Sans la ligne, « Collecter maintenant »
 * donnait un passage clos en silence, indistinguable d'un worker mort depuis le serveur.
 * Le message est un littéral de `MSG` : il ne porte ni clé, ni URL de proxy.
 */
async function refuser(
  pool: Pool,
  job: CollecteLinkedInJob,
  message: string,
  etat: { statut?: 'success' | 'error'; bilan?: Bilan; sortie?: Sortie | null } = {},
): Promise<void> {
  console.warn(`[collecte-linkedin] passage ${job.sourceRunId} refusé : ${message}`);
  await cloreCollecte(pool, job, { statut: etat.statut ?? 'error', erreur: message, bilan: etat.bilan, sortie: etat.sortie });
}

export async function traiterCollecteLinkedIn(d: DependancesCollecte, job: CollecteLinkedInJob): Promise<void> {
  const { pool } = d;
  const ctx: Contexte = { ex: pool, organisationId: job.organizationId, utilisateurId: null, role: null };

  if (d.env.JAY_REACH_LINKEDIN !== '1') {
    await refuser(pool, job, MSG.canal);
    return;
  }
  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') {
    await refuser(pool, job, MSG.session);
    return;
  }
  const config = await lireConfigCollecte(pool, job);
  if (config === null) {
    await refuser(pool, job, MSG.source);
    return;
  }
  if ('erreur' in config) {
    await refuser(pool, job, config.erreur);
    return;
  }

  const proprietaire = `collecte-${job.sourceRunId}`;
  const bilan = bilanVierge();
  let sortie: Sortie | null = null;
  let verrouPris = false;
  /**
   * Le trafic LinkedIn est-il derrière nous ? La boucle d'enregistrement qui suit
   * `lireEngageurs` ne fait que du Postgres — plusieurs insertions par personne,
   * jusqu'à cinquante par page — et un `statement timeout`, un deadlock ou un
   * pooler saturé y lève une erreur inconnue. Sans ce drapeau, trois incidents de
   * base de suite exigeaient de l'opérateur qu'il reconnecte son compte LinkedIn.
   * La précaution « erreur inconnue = verdict » reste là où elle se justifie :
   * tant qu'on peut encore être en train de parler à LinkedIn.
   */
  let traficTermine = false;
  // Ouvert DANS le `try` : c'est le seul chemin où le navigateur peut être
  // réellement ouvert (`puppeteer.connect` passe, `newPage` échoue) sans qu'aucune
  // clôture ne soit jouée. Le passage restait alors `running` trente minutes, le
  // temps que `closeStaleSourceRuns` l'écrive en « worker arrêté » — un message
  // faux, après une demi-heure de silence, là où tous les autres refus closent
  // immédiatement avec leur motif. Cas le plus probable au premier déploiement :
  // `LINKEDIN_BROWSER_URL` absent.
  let pilote: Pilote | null = null;
  try {
    try {
      pilote = await d.ouvrirNavigateur();
    } catch (err) {
      // Le message peut porter l'URL du proxy ou du navigateur : seul le type sort.
      // Verdict faux : un conteneur injoignable est un incident d'hébergement, et
      // une reconnexion LinkedIn n'y répondrait pas.
      const type = err instanceof Error ? err.name : 'Erreur';
      // Journalisé : c'est le seul chemin du handler qui n'en avait aucun, et le
      // premier qu'on lira au premier déploiement.
      console.error(`[collecte-linkedin] navigateur indisponible (${type})`);
      await cloreCollecte(pool, job, { statut: 'error', erreur: `${MSG.navigateur} (${type})` });
      return;
    }
    // Avant d'ouvrir LinkedIn : l'écho d'IP part d'une page neutre.
    // La relève se fait ICI, et n'est PAS confiée à `controlerSortie` : le `catch`
    // de `verifierSortie` est inconditionnel et remplacerait notre erreur nommée
    // par une `Error` nue — l'écran Sources afficherait « Collecte interrompue
    // (Error). » au lieu de dire que le proxy ne répond pas. Le verdict, lui,
    // restait juste, ce qui est précisément pourquoi aucun contrôle ne l'a vu.
    //
    // Verdict VRAI : l'écho est chargé par le navigateur, donc par le proxy —
    // trois échecs d'affilée disent qu'il est mort, et c'est ce que le
    // disjoncteur doit attraper.
    let brute: Sortie;
    try {
      brute = await d.releverSortie(pilote);
    } catch {
      throw new ErreurCollecte(MSG.releve, 'SortieInjoignable', true);
    }
    // La relève est faite : celle-ci ne peut plus lever.
    const controle = await controlerSortie(ctx, session.ipAttendue, async () => brute);
    sortie = controle.sortie;
    if (!controle.ok) {
      // `verifierSortie` a déjà bloqué la session.
      // PAS de verdict : ce chemin bloque déjà la session lui-même, sa contribution
      // au disjoncteur serait redondante — et nuisible. `confirmerIpAttendue` lève le
      // blocage sans toucher `connected_at`, donc l'échec resterait dans la fenêtre :
      // trois changements d'IP résolus par l'opérateur et la session se rebloquait en
      // « Trop d'échecs d'affilée », ce qui l'envoie reconnecter pour un problème déjà
      // réglé.
      await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.sortie, sortie });
      return;
    }

    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_COLLECTE_MS);
    if (!verrouPris) {
      await refuser(pool, job, MSG.verrou, { sortie });
      return;
    }

    const budget = await calculerBudget(ctx, job.sourceRunId);
    if (budget.postsRestants <= 0 || budget.requetesRestantes <= 0 || budget.personnesMax <= 0) {
      // Plafond : un passage à vide, pas un échec. Le rejouer redépasserait le
      // même plafond.
      await refuser(
        pool,
        job,
        budget.postsRestants <= 0
          ? MSG.plafond_posts
          : budget.requetesRestantes <= 0
            ? MSG.plafond_requetes
            : MSG.plafond_personnes,
        { statut: 'success', bilan, sortie },
      );
      return;
    }

    const surRequete = async (): Promise<void> => {
      await tracerRequeteLinkedIn(ctx, job.sourceRunId);
      bilan.requetes += 1;
    };
    const { personnes, arret } = await lireEngageurs(pilote, config.urlPost, config.garder, budget, surRequete, d.pause);
    // Plus une seule requête LinkedIn après ce point : tout ce qui suit est du
    // Postgres. Une erreur qui survient là ne dit RIEN du compte.
    traficTermine = true;
    bilan.vus = personnes.length;

    const contexteEngageur = {
      pool,
      organizationId: job.organizationId,
      sourceId: job.sourceId,
      // Obligatoire depuis la tâche 6 : sans lui, l'écart par le scoring serait
      // compté sur le mauvais passage.
      sourceRunId: job.sourceRunId,
    };
    for (const [rang, personne] of personnes.entries()) {
      // `enregistrerEngageur` LÈVE sur une entrée invalide : un seul profil
      // malformé emporterait tout le passage. On valide ici, et on compte ce
      // qu'on laisse de côté.
      const valide = engageurSchema.safeParse(personne);
      if (!valide.success) {
        bilan.ignores += 1;
        continue;
      }
      const issue: IssueEngageur = await enregistrerEngageur(contexteEngageur, valide.data, config.campagne, config.urlPost);
      if (issue === 'nouveau') {
        bilan.nouveaux += 1;
        if (adresseDeduite(valide.data)) bilan.adressesDeduites += 1;
      } else if (issue === 'deja_en_campagne') bilan.dejaEnCampagne += 1;
      else if (issue === 'supprime') bilan.opposes += 1;
      else bilan.doublons += 1; // `doublon` et `ecarte` : déjà connus, rien de neuf

      // Plafond de personnes ENREGISTRÉES : il compte les nouvelles, pas les lues. Les étages
      // aval sont plafonnés (scoring, enrichissement) à un ou deux ordres de grandeur de ce
      // que soixante requêtes laissent entrer ; ce qui déborde serait effacé à quatorze jours
      // sans mémoire, recollecté, recréé. Compter les NOUVELLES fait avancer un second passage
      // au-delà des doublons du premier ; le reste n'est jamais écrit en base.
      if (bilan.nouveaux >= budget.personnesMax) {
        bilan.plafondPersonnes = rang < personnes.length - 1;
        break;
      }
    }

    if (typeof arret === 'object') {
      const message = await traiterFriction(ctx, pool, arret);
      await cloreCollecte(pool, job, {
        statut: 'error',
        erreur: message,
        bilan,
        sortie,
        // Un défi ou un cookie refusé sont des verdicts sur le compte (ils bloquent
        // déjà la session). Un post introuvable et une liste vide n'en sont pas :
        // LinkedIn a répondu normalement.
        verdictLinkedIn: arret.type === 'defi' || arret.type === 'cookie_refuse',
      });
      return;
    }

    await marquerCollecteLinkedIn(ctx);
    await cloreCollecte(pool, job, {
      statut: 'success',
      erreur: bilan.plafondPersonnes ? MSG.plafond_personnes : arret === 'plafond' ? MSG.plafond_requetes : null,
      bilan,
      sortie,
      // Un passage qui a parlé à LinkedIn et abouti est le verdict qui remet le
      // disjoncteur à zéro.
      verdictLinkedIn: bilan.requetes > 0,
    });
    console.log(
      `[collecte-linkedin] ${bilan.requetes} requête(s), ${bilan.vus} personne(s) vue(s), ${bilan.nouveaux} nouvelle(s), ${bilan.doublons} doublon(s), ${bilan.dejaEnCampagne} déjà en campagne, ${bilan.ignores} ignorée(s), ${bilan.opposes} opposée(s), ${bilan.adressesDeduites} à adresse déduite${bilan.plafondPersonnes ? ', plafond de personnes atteint' : ''}`,
    );
  } catch (err) {
    // Le message d'origine peut porter l'URL du proxy avec ses identifiants :
    // seul le type d'erreur est consigné. Journalisé AVANT la clôture, pour qu'une
    // base indisponible ne remplace pas l'erreur d'origine par la sienne.
    const type = err instanceof Error ? err.name : 'Erreur';
    console.error(`[collecte-linkedin] passage interrompu (${type})`);
    // Une `ErreurCollecte` est construite par nous : son message ne peut porter ni
    // clé, ni mot de passe, ni URL de proxy, et il est bien plus utile à l'écran
    // Sources que le nom d'une classe. Pour tout le reste, le nom seul.
    const connue = err instanceof ErreurCollecte;
    await cloreCollecte(pool, job, {
      statut: 'error',
      erreur: connue ? err.message : `Collecte interrompue (${type}).`,
      bilan,
      sortie,
      // Une erreur inconnue est tenue pour un verdict TANT QUE le trafic LinkedIn
      // n'est pas terminé : on ne sait pas d'où elle vient, et le disjoncteur est
      // la précaution. Après, c'est forcément la base. Nos propres échecs de
      // lecture, eux, le disent franchement.
      //
      // Une erreur Postgres est reconnue à tout moment : `calculerBudget` et
      // `tracerRequeteLinkedIn` — appelé à CHAQUE requête — lèvent avant que le
      // trafic soit terminé, et un pooler saturé n'a jamais rien dit du compte.
      verdictLinkedIn: connue ? err.engageLeCompte : !(traficTermine || err instanceof DatabaseError),
    });
    await verifierDisjoncteur(ctx, pool);
    throw err;
  } finally {
    // Durée nulle, même propriétaire : le verrou tombe tout de suite plutôt que
    // de tenir dix minutes après un passage terminé.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    if (pilote) await pilote.fermer().catch(() => undefined);
  }
}

/** Les dépendances réelles. L'import du navigateur est dynamique : `puppeteer-core` n'est chargé que si une collecte part. */
export function dependancesCollecteReelles(pool: Pool): DependancesCollecte {
  return {
    pool,
    env: process.env,
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

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
import type { Pool } from 'pg';
import {
  bloquerSessionLinkedIn,
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  jourCourantDansFuseau,
  lireFenetreLinkedIn,
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
import { lireEngageurs, type Budget, type Friction } from '../linkedin/engageurs.js';
import { engageurSchema, enregistrerEngageur, type IssueEngageur } from './post-engagement.js';
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

const MSG = {
  canal: 'Le canal LinkedIn serveur est désactivé (JAY_REACH_LINKEDIN).',
  session: 'La session LinkedIn n’est pas active : reconnectez le compte.',
  source: 'Cette source d’engageurs n’est reliée à aucune campagne active.',
  persona: 'La campagne porte plusieurs personas : choisissez celui de la source.',
  sortie: 'Le navigateur est sorti par une adresse inattendue : collecte annulée.',
  verrou: 'Un autre passage conduit déjà le navigateur LinkedIn.',
  plafond_posts: 'Plafond de posts du jour atteint.',
  plafond_requetes: 'Plafond de requêtes de l’heure atteint.',
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
}

const bilanVierge = (): Bilan => ({ requetes: 0, vus: 0, nouveaux: 0, doublons: 0, dejaEnCampagne: 0, ignores: 0 });

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
 * tâche 6) et sortie observée. `items_found`/`items_new` reçoivent les mêmes
 * nombres que `vus`/`nouveaux` pour que la carte « dernier passage » de l'écran
 * Sources, écrite pour les connecteurs d'offres, continue d'afficher ce passage.
 *
 * Le filtre par organisation est explicite : le worker écrit avec la clé de
 * service, que la RLS ne borne pas.
 */
async function cloreCollecte(
  pool: Pool,
  job: CollecteLinkedInJob,
  etat: { statut: 'success' | 'error'; erreur?: string | null; bilan?: Bilan; sortie?: Sortie | null },
): Promise<void> {
  const b = etat.bilan ?? bilanVierge();
  await pool.query(
    `update source_runs sr /* jr:linkedin_collecte_clore */
        set finished_at = now(), status = $3, error = $4,
            items_found = $5, items_new = $6,
            requetes = $7, vus = $5, nouveaux = $6, doublons = $8, deja_en_campagne = $9,
            ip_sortie = $10, operateur_sortie = $11
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
 * Y entrent aussi les passages refermés par `closeStaleSourceRuns` (worker tué
 * en plein travail) et ceux qu'une friction a arrêtés : trois échecs d'affilée,
 * quelle qu'en soit la cause, veulent dire que ça ne marche pas, et la
 * reconnexion remet tout à zéro. Évalué seulement quand le passage courant a
 * échoué sur une exception, jamais après un succès.
 */
async function verifierDisjoncteur(ctx: Contexte, pool: Pool): Promise<void> {
  const res = await pool.query<{ status: string }>(
    `select sr.status /* jr:linkedin_collecte_derniers */
       from source_runs sr
       join sources so on so.id = sr.source_id
      where so.organization_id = $1
        and so.config->>'sourceType' = 'linkedin_post_engagers'
        and sr.finished_at is not null
      order by sr.finished_at desc
      limit 3`,
    [ctx.organisationId],
  );
  if (res.rows.length === 3 && res.rows.every((r) => r.status === 'error')) {
    await bloquerSessionLinkedIn(ctx, 'disjoncteur');
  }
}

/** Ce qu'il reste à dépenser. Le passage courant est DÉJÀ ouvert : il ne doit pas se compter contre lui-même. */
async function calculerBudget(ctx: Contexte): Promise<Budget> {
  const { fuseau } = await lireFenetreLinkedIn(ctx);
  const [plafondPosts, postsDuJour, plafondRequetes, requetesDeLHeure] = await Promise.all([
    lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour'),
    compterPostsLinkedInDuJour(ctx, jourCourantDansFuseau(fuseau), fuseau),
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    // Fenêtre GLISSANTE : la dernière heure. Aucun calcul de jour, aucun fuseau
    // ici — un plafond horaire calé sur l'heure ronde laisserait passer deux
    // pleines charges à cheval sur la minute 59.
    compterRequetesLinkedIn(ctx, new Date(Date.now() - UNE_HEURE_MS)),
  ]);
  return {
    postsRestants: Math.max(0, plafondPosts - postsDuJour + 1),
    requetesRestantes: Math.max(0, plafondRequetes - requetesDeLHeure),
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

export async function traiterCollecteLinkedIn(d: DependancesCollecte, job: CollecteLinkedInJob): Promise<void> {
  const { pool } = d;
  const ctx: Contexte = { ex: pool, organisationId: job.organizationId, utilisateurId: null, role: null };

  if (d.env.JAY_REACH_LINKEDIN !== '1') {
    await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.canal });
    return;
  }
  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') {
    await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.session });
    return;
  }
  const config = await lireConfigCollecte(pool, job);
  if (config === null) {
    await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.source });
    return;
  }
  if ('erreur' in config) {
    await cloreCollecte(pool, job, { statut: 'error', erreur: config.erreur });
    return;
  }

  const proprietaire = `collecte-${job.sourceRunId}`;
  const bilan = bilanVierge();
  let sortie: Sortie | null = null;
  let verrouPris = false;
  const pilote = await d.ouvrirNavigateur();
  try {
    // Avant d'ouvrir LinkedIn : l'écho d'IP part d'une page neutre.
    const controle = await controlerSortie(ctx, session.ipAttendue, () => d.releverSortie(pilote));
    sortie = controle.sortie;
    if (!controle.ok) {
      // `verifierSortie` a déjà bloqué la session.
      await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.sortie, sortie });
      return;
    }

    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_COLLECTE_MS);
    if (!verrouPris) {
      await cloreCollecte(pool, job, { statut: 'error', erreur: MSG.verrou, sortie });
      return;
    }

    const budget = await calculerBudget(ctx);
    if (budget.postsRestants <= 0 || budget.requetesRestantes <= 0) {
      // Plafond : un passage à vide, pas un échec. Le rejouer redépasserait le
      // même plafond.
      await cloreCollecte(pool, job, {
        statut: 'success',
        erreur: budget.postsRestants <= 0 ? MSG.plafond_posts : MSG.plafond_requetes,
        bilan,
        sortie,
      });
      return;
    }

    const surRequete = async (): Promise<void> => {
      await tracerRequeteLinkedIn(ctx, job.sourceRunId);
      bilan.requetes += 1;
    };
    const { personnes, arret } = await lireEngageurs(pilote, config.urlPost, config.garder, budget, surRequete, d.pause);
    bilan.vus = personnes.length;

    const contexteEngageur = {
      pool,
      organizationId: job.organizationId,
      sourceId: job.sourceId,
      // Obligatoire depuis la tâche 6 : sans lui, l'écart par le scoring serait
      // compté sur le mauvais passage.
      sourceRunId: job.sourceRunId,
    };
    for (const personne of personnes) {
      // `enregistrerEngageur` LÈVE sur une entrée invalide : un seul profil
      // malformé emporterait tout le passage. On valide ici, et on compte ce
      // qu'on laisse de côté.
      const valide = engageurSchema.safeParse(personne);
      if (!valide.success) {
        bilan.ignores += 1;
        continue;
      }
      const issue: IssueEngageur = await enregistrerEngageur(contexteEngageur, valide.data, config.campagne, config.urlPost);
      if (issue === 'nouveau') bilan.nouveaux += 1;
      else if (issue === 'deja_en_campagne') bilan.dejaEnCampagne += 1;
      else bilan.doublons += 1; // `doublon` et `ecarte` : déjà connus, rien de neuf
    }

    if (typeof arret === 'object') {
      const message = await traiterFriction(ctx, pool, arret);
      await cloreCollecte(pool, job, { statut: 'error', erreur: message, bilan, sortie });
      return;
    }

    await marquerCollecteLinkedIn(ctx);
    await cloreCollecte(pool, job, {
      statut: 'success',
      erreur: arret === 'plafond' ? MSG.plafond_requetes : null,
      bilan,
      sortie,
    });
    console.log(
      `[collecte-linkedin] ${bilan.requetes} requête(s), ${bilan.vus} personne(s) vue(s), ${bilan.nouveaux} nouvelle(s), ${bilan.doublons} doublon(s), ${bilan.dejaEnCampagne} déjà en campagne, ${bilan.ignores} ignorée(s)`,
    );
  } catch (err) {
    // Le message d'origine peut porter l'URL du proxy avec ses identifiants :
    // seul le type d'erreur est consigné. Journalisé AVANT la clôture, pour qu'une
    // base indisponible ne remplace pas l'erreur d'origine par la sienne.
    const type = err instanceof Error ? err.name : 'Erreur';
    console.error(`[collecte-linkedin] passage interrompu (${type})`);
    await cloreCollecte(pool, job, { statut: 'error', erreur: `Collecte interrompue (${type}).`, bilan, sortie });
    await verifierDisjoncteur(ctx, pool);
    throw err;
  } finally {
    // Durée nulle, même propriétaire : le verrou tombe tout de suite plutôt que
    // de tenir dix minutes après un passage terminé.
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    await pilote.fermer().catch(() => undefined);
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

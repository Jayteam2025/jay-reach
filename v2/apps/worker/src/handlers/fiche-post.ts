/**
 * Handler de la file `linkedin.fiche-post` : ce qui manque aux fiches de post, en DEUX natures de
 * travail que ce fichier ne doit jamais confondre.
 *
 *  - **relire une page** : les fiches que la collecte n'a pas pu remplir — nées de la reprise de
 *    l'existant (ni auteur, ni texte, ni date), capture échouée en cours de passage, ou restées
 *    incomplètes. Celles-là coûtent une page LinkedIn chacune : pause, trace, plafonds.
 *  - **écrire un sujet** : les fiches COMPLÈTES dont le sujet manque, c'est-à-dire ce que produit
 *    une collecte qui réussit. Leur texte est DÉJÀ en base : les rouvrir dépenserait une requête
 *    LinkedIn pour un contenu qu'on a. Elles n'émettent donc rien vers LinkedIn, et le navigateur
 *    ne s'ouvre même pas quand un lot n'en contient que de celles-là.
 *
 * Il OUVRE des pages LinkedIn : la file est exclue de la route cron de Vercel
 * (`FILES_AVEC_NAVIGATEUR`), le navigateur ne vit que sur le serveur dédié.
 *
 * **Un job par ORGANISATION, pas par fiche.** Un job par fiche aurait ouvert jusqu'à vingt
 * navigateurs coup sur coup, chacun émettant du trafic par le proxy avant de savoir s'il avait le
 * verrou. Ici la file est `stately` (un job en attente par organisation, comme `linkedin.envoi`) ;
 * le lot prend le verrou AVANT d'ouvrir quoi que ce soit (la collecte le tient : on sort sans
 * trafic), ouvre UN navigateur, puis lit ses fiches À LA SUITE, sous ce même verrou, avec une pause
 * avant chaque page et une trace par lecture dans `linkedin_requetes` (même budget horaire que la
 * collecte). Le plafond du jour compte ces traces : une lecture compte, qu'elle réussisse ou non.
 *
 * Une page illisible ne lève pas : `capture_attempts` monte, la fiche reste `pending`, et la
 * sélection cesse de la proposer à la troisième tentative. Aucun secret ni URL de proxy dans un
 * message : seul le type d'erreur est consigné.
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import {
  compterFichesPostLinkedInDuJour,
  compterRequetesLinkedIn,
  fuseauDeLOrganisation,
  jourCourantDansFuseau,
  lirePlafondLinkedIn,
  lireSessionLinkedIn,
  plafondDuJour,
  prendreVerrouLinkedIn,
  tracerLectureFichePost,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { resolveProviderCredentials } from '../credentials.js';
import { createAnthropicRedacteurDeSujet } from '../sujet-post-anthropic.js';
import { controlerSortie } from '../linkedin/controle-sortie.js';
import { delaiAleatoire } from '../linkedin/engageurs.js';
import { lireFichePost } from '../linkedin/fiche-post.js';
import type { Pilote } from '../linkedin/navigateur.js';
import { enregistrerFichePost, fenetreValidationPost, fichesARattraper } from '../linkedin/posts-fiches.js';

export type FichePostJob = { organizationId: string };

/**
 * Ce qu'un appel au rédacteur a donné. Trois issues, et pas un `string | null`, parce que deux
 * façons de n'avoir pas de sujet ne se comptent pas pareil :
 *
 *  - `refuse` : le modèle a été sollicité, le crédit est parti, rien d'utilisable n'en sort. C'est
 *    une TENTATIVE — le même texte redonnera la même chose au passage suivant.
 *  - `impossible` : rien n'a été demandé (texte vide, plafond du jour atteint, pas de clé). Ce
 *    n'est pas une tentative : le lendemain, ou la clé saisie, change tout, et brûler les
 *    tentatives d'une fiche là-dessus la condamnerait sans qu'aucun modèle ne l'ait jamais vue.
 */
export type IssueSujet = { readonly etat: 'ecrit'; readonly sujet: string } | { readonly etat: 'refuse' } | { readonly etat: 'impossible' };

/** Le texte d'un post, ramené à un sujet nommable. */
export type RedacteurDeSujet = (texte: string) => Promise<IssueSujet>;

/** Tout ce que le handler touche hors base, injecté pour que le harnais Postgres le joue sans LinkedIn. */
export interface DependancesFichePost {
  readonly pool: Pool;
  readonly env: Record<string, string | undefined>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  pause(ms: number): Promise<void>;
  /** Le rédacteur de l'organisation : il dépense SON crédit et lit SES clés, d'où le paramètre. */
  redacteurPour(organizationId: string): Promise<RedacteurDeSujet>;
}

/** Fiches lues au plus par lot : un lot par heure et par organisation, le plafond du jour borne le reste. */
export const LOT_MAX = 5;
/**
 * Sujets rédigés au plus par lot. Borne PROPRE à la rédaction, délibérément distincte de
 * `placeRestante` : rédiger n'ouvre aucune page LinkedIn, donc les plafonds de requêtes n'ont rien
 * à dire ici — les y soumettre interdirait d'écrire le moindre sujet le jour où le quota de pages
 * est épuisé, alors que le texte est déjà en base.
 *
 * Une CONSTANTE, et pas un réglage : c'est la borne la plus simple qui tienne, et la dépense a
 * déjà son plafond réglable — `scoring_par_jour`, que `prendreCreditAnthropic` consulte avant
 * chaque appel. Un second réglage pour le même crédit donnerait deux chiffres à tenir d'accord,
 * pour un écran de plus. Celle-ci ne borne que le travail d'UN passage : vingt appels au modèle
 * tiennent très au large dans les dix minutes du verrou, que la collecte attend derrière.
 */
export const SUJETS_PAR_LOT_MAX = 20;
/** Le verrou couvre un lot entier : cinq pages espacées de quelques secondes, avec une large marge. */
const DUREE_VERROU_LOT_MS = 10 * 60_000;
const UNE_HEURE_MS = 3_600_000;

const FILE = 'linkedin.fiche-post';

/**
 * Une unité du crédit `anthropic` du jour, le même que consomme le scoring (même plafond, même clé de
 * jour de l'organisation). Pas de plafond neuf : un plafond atteint rend `false`.
 */
export async function prendreCreditAnthropic(pool: Pool, organizationId: string): Promise<boolean> {
  const plafond = await plafondDuJour(pool, organizationId, 'scoring_par_jour');
  const jour = jourCourantDansFuseau(await fuseauDeLOrganisation(pool, organizationId));
  const credit = await pool.query<{ ok: boolean }>(
    `select app.consume_provider_credit($1, 'anthropic', $2, 1, $3::date) as ok /* jr:fiche_post_credit */`,
    [organizationId, plafond, jour],
  );
  return credit.rows[0]?.ok === true;
}

/** Ce qu'il reste à lire, sous les DEUX plafonds : celui du jour, et le budget horaire de la collecte. */
async function placeRestante(ctx: Contexte): Promise<number> {
  const fuseau = await fuseauDeLOrganisation(ctx.ex, ctx.organisationId);
  const [plafondJour, luesAujourdhui, plafondHeure, requetesHeure] = await Promise.all([
    lirePlafondLinkedIn(ctx, 'linkedin_fiches_post_par_jour'),
    compterFichesPostLinkedInDuJour(ctx, jourCourantDansFuseau(fuseau), fuseau),
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    compterRequetesLinkedIn(ctx, new Date(Date.now() - UNE_HEURE_MS)),
  ]);
  return Math.max(0, Math.min(LOT_MAX, plafondJour - luesAujourdhui, plafondHeure - requetesHeure));
}

export async function traiterFichePost(d: DependancesFichePost, job: FichePostJob): Promise<void> {
  const { pool } = d;
  const ctx: Contexte = { ex: pool, organisationId: job.organizationId, utilisateurId: null, role: null };
  if (d.env.JAY_REACH_LINKEDIN !== '1') return;
  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') return;

  // Le verrou AVANT le navigateur : tenu par une collecte, on sort sans avoir émis le moindre trafic.
  const proprietaire = `fiche-post-${job.organizationId}`;
  if (!(await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_LOT_MS))) return;
  let pilote: Pilote | null = null;
  try {
    // Les deux bornes, chacune sur sa population : les plafonds de requêtes LinkedIn pour les
    // fiches à relire, une borne de passage pour celles qu'il suffit de rédiger.
    const place = await placeRestante(ctx);
    const fiches = await fichesARattraper(pool, job.organizationId, {
      aRelire: place,
      aRediger: SUJETS_PAR_LOT_MAX,
    });
    if (fiches.length === 0) return;
    const aRelire = fiches.some((f) => f.a_relire);

    // Le navigateur ne s'ouvre QUE s'il reste une page à lire : un lot qui ne fait que rédiger des
    // sujets n'émet pas un octet vers LinkedIn.
    if (aRelire) {
      try {
        pilote = await d.ouvrirNavigateur();
      } catch (err) {
        // Le message peut porter l'URL du navigateur ou du proxy : seul le type sort. L'erreur est
        // relancée pour que pg-boss reprenne le job (deux reprises).
        const type = err instanceof Error ? err.name : 'Erreur';
        console.error(`[fiche-post] navigateur indisponible (${type})`);
        throw new Error(`Navigateur LinkedIn indisponible (${type}).`);
      }
      let brute: Sortie;
      try {
        brute = await d.releverSortie(pilote);
      } catch {
        throw new Error('Impossible de relever l’IP de sortie du navigateur.');
      }
      const controle = await controlerSortie(ctx, session.ipAttendue, async () => brute);
      // `verifierSortie` a déjà bloqué la session : rien ne doit partir vers LinkedIn, et le lot
      // s'arrête entier — une session bloquée n'est plus un contexte où l'on dépense.
      if (!controle.ok) return;
    }

    // Résolu à la première fiche qui en a besoin : aucune clé lue pour un lot sans sujet à rédiger.
    let redacteur: RedacteurDeSujet | null = null;
    // Lue UNE fois pour tout le lot, et seulement si une fiche doit être réécrite : c'est un
    // réglage d'organisation, pas une constante. `null` — et surtout pas 0 — quand il n'y a rien à
    // relire : une fenêtre de 0 jour ferait expirer chaque fiche à la seconde où elle naît, donc
    // ce chiffre ne doit jamais exister à portée de `enregistrerFichePost`.
    const fenetreJours = aRelire ? await fenetreValidationPost(pool, job.organizationId) : null;
    for (const ligne of fiches) {
      let texte = ligne.text_excerpt;
      if (ligne.a_relire && pilote && fenetreJours !== null) {
        // Toujours une pause : enchaîner des pages sans délai est ce qui se repère le mieux.
        await d.pause(delaiAleatoire());
        // AVANT l'ouverture : la trace dit ce qui est parti, et une page dont la lecture échoue est
        // quand même partie.
        await tracerLectureFichePost(ctx, ligne.id);
        // Ne lève jamais : une page illisible rend une fiche aux champs nuls, que `enregistrerFichePost`
        // compte comme une tentative sans rien effacer.
        const fiche = await lireFichePost(pilote, ligne.url);
        await enregistrerFichePost(pool, job.organizationId, fiche, { fenetreJours });
        texte = fiche.texte ?? ligne.text_excerpt;
      }

      // Le sujet : seulement s'il n'y en a pas (un sujet de l'opérateur ne se remplace jamais).
      if (ligne.subject === null && texte !== null) {
        const indisponible: IssueSujet = { etat: 'impossible' };
        redacteur ??= await d.redacteurPour(job.organizationId).catch(() => async () => indisponible);
        const issue = await redacteur(texte).catch(() => indisponible);
        if (issue.etat === 'ecrit') {
          await pool.query(
            `update linkedin_posts set subject = $3, subject_origin = 'model' /* jr:fiche_post_sujet */
              where organization_id = $1 and id = $2 and subject is null`,
            [job.organizationId, ligne.id, issue.sujet],
          );
        } else if (issue.etat === 'refuse') {
          // Le modèle a vu ce texte et n'en a rien tiré : une tentative de moins avant de cesser
          // de le lui redemander. `TENTATIVES_SUJET_MAX` dit pourquoi.
          await pool.query(
            `update linkedin_posts set subject_attempts = subject_attempts + 1 /* jr:fiche_post_sujet_tentative */
              where organization_id = $1 and id = $2`,
            [job.organizationId, ligne.id],
          );
        }
      }
    }
  } finally {
    await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    if (pilote) await pilote.fermer().catch(() => undefined);
  }
}

/**
 * Les dépendances réelles. Le rédacteur est celui d'Anthropic, avec la clé de l'organisation ; sans
 * clé, il rend `impossible` (la fiche garde son sujet vide et toutes ses tentatives, l'opérateur
 * le saisit à l'écran ou saisit sa clé).
 */
export function dependancesFichePostReelles(pool: Pool, encryptionKey?: string): DependancesFichePost {
  return {
    pool,
    env: process.env,
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    redacteurPour: async (organizationId) => {
      const credentials = await resolveProviderCredentials(pool, organizationId, 'anthropic', { encryptionKey });
      const apiKey = credentials?.api_key;
      // Pas de clé : rien n'est demandé, donc aucune tentative n'est consommée. La fiche reste
      // demandable le jour où l'opérateur saisit sa clé.
      if (!apiKey) return async () => ({ etat: 'impossible' });
      return createAnthropicRedacteurDeSujet({
        apiKey,
        config: { model_smart: credentials?.model_smart },
        prendreCredit: () => prendreCreditAnthropic(pool, organizationId),
      });
    },
  };
}

/**
 * Le rattrapage : dépose UN job de lot par organisation à session active qui a du travail — une
 * fiche à rouvrir sous les plafonds de requêtes, OU un sujet à rédiger, qui n'en consomme aucun.
 * Ne demander que le premier laisserait le chemin nominal sans job : une collecte qui réussit ne
 * produit que des fiches complètes. La clé de singleton est l'organisation et la file est
 * `stately` : un second `send` pendant qu'un job attend rend `null`, ce qui n'est pas une erreur.
 * Retourne le nombre de jobs RÉELLEMENT déposés.
 */
export async function enqueueFichesPostALire(boss: PgBoss, pool: Pool): Promise<number> {
  const orgs = await pool.query<{ organization_id: string }>(
    `select organization_id /* jr:fiche_post_organisations */
       from linkedin_server_sessions where status = 'active'`,
  );
  let deposes = 0;
  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      const ctx: Contexte = { ex: pool, organisationId: organizationId, utilisateurId: null, role: null };
      const place = await placeRestante(ctx);
      // Une fiche de chaque nature suffit à décider : le lot refera la sélection avec ses bornes.
      const travail = await fichesARattraper(pool, organizationId, { aRelire: place > 0 ? 1 : 0, aRediger: 1 });
      if (travail.length === 0) continue;
      const id = await boss.send(FILE, { organizationId } satisfies FichePostJob, { singletonKey: organizationId });
      if (id !== null) deposes += 1;
    } catch (err) {
      // Une organisation qui échoue n'emporte pas les autres. Seul le type d'erreur sort.
      console.error(
        `[fiche-post] enfilage impossible pour une organisation (${err instanceof Error ? err.name : 'erreur'})`,
      );
    }
  }
  return deposes;
}

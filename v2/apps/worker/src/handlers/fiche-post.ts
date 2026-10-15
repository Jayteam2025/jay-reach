/**
 * Handler de la file `linkedin.fiche-post` : le RATTRAPAGE des fiches de post incomplètes.
 *
 * La collecte capture déjà la fiche de chaque post qu'elle ouvre, sans requête de plus. Ce travail
 * de fond ne sert qu'aux fiches que la collecte n'a pas pu remplir : celles nées de la reprise de
 * l'existant (ni auteur, ni texte, ni date), celles dont la capture a échoué en cours de passage,
 * et toute fiche restée incomplète. Il OUVRE une page LinkedIn : la file est exclue de la route
 * cron de Vercel (`FILES_AVEC_NAVIGATEUR`), le navigateur ne vit que sur le serveur dédié.
 *
 * Mêmes garde-fous que la collecte, dans le même ordre : canal autorisé, session active, IP de
 * sortie relevée AVANT d'ouvrir LinkedIn, verrou du navigateur. Une page illisible ne lève pas :
 * `capture_attempts` monte, la fiche reste `pending`, et le producteur cesse de la redemander à
 * la troisième tentative (un post supprimé ne se redemande pas indéfiniment).
 *
 * Aucun secret ni URL de proxy dans un message : seul le type d'erreur est consigné.
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import {
  fuseauDeLOrganisation,
  jourCourantDansFuseau,
  lirePlafondLinkedIn,
  lireSessionLinkedIn,
  prendreVerrouLinkedIn,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';
import { controlerSortie } from '../linkedin/controle-sortie.js';
import { lireFichePost } from '../linkedin/fiche-post.js';
import type { Pilote } from '../linkedin/navigateur.js';
import { enregistrerFichePost, ficheIncomplete } from '../linkedin/posts-fiches.js';
import { deterministicUuid } from '../ids.js';

export type FichePostJob = { organizationId: string; postId: string };

/** Le texte d'un post, ramené à un sujet nommable ; `null` quand le modèle ne sait pas en tirer un. */
export type RedacteurDeSujet = (texte: string) => Promise<string | null>;

/** Tout ce que le handler touche hors base, injecté pour que le harnais Postgres le joue sans LinkedIn. */
export interface DependancesFichePost {
  readonly pool: Pool;
  readonly env: Record<string, string | undefined>;
  ouvrirNavigateur(): Promise<Pilote>;
  releverSortie(pilote: Pilote): Promise<Sortie>;
  readonly redacteur: RedacteurDeSujet;
}

/** Tentatives de capture au-delà desquelles une fiche n'est plus redemandée. */
export const TENTATIVES_MAX = 3;
/** Fenêtre de décision d'une fiche, en jours (le réglage arrive à la tâche 8). */
const FENETRE_DECISION_JOURS = 28;
/** Un verrou court : le traitement fait une navigation, pas une collecte. */
const DUREE_VERROU_FICHE_MS = 5 * 60_000;

const FILE = 'linkedin.fiche-post';

export async function traiterFichePost(d: DependancesFichePost, job: FichePostJob): Promise<void> {
  const { pool } = d;
  const ctx: Contexte = { ex: pool, organisationId: job.organizationId, utilisateurId: null, role: null };
  if (d.env.JAY_REACH_LINKEDIN !== '1') return;
  const session = await lireSessionLinkedIn(ctx);
  if (!session || session.etat !== 'active') return;

  const lue = await pool.query<{
    id: string;
    url: string;
    author_name: string | null;
    text_excerpt: string | null;
    posted_at: Date | null;
    subject: string | null;
  }>(
    `select id, url, author_name, text_excerpt, posted_at, subject /* jr:fiche_post_lire */
       from linkedin_posts where organization_id = $1 and id = $2`,
    [job.organizationId, job.postId],
  );
  const ligne = lue.rows[0];
  // Complétée entre-temps (par la collecte, par exemple) : rien à rattraper.
  if (!ligne || !ficheIncomplete(ligne)) return;

  const proprietaire = `fiche-post-${job.postId}`;
  let verrouPris = false;
  let pilote: Pilote | null = null;
  try {
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
    // `verifierSortie` a déjà bloqué la session : rien ne doit partir vers LinkedIn.
    if (!controle.ok) return;

    verrouPris = await prendreVerrouLinkedIn(ctx, proprietaire, DUREE_VERROU_FICHE_MS);
    if (!verrouPris) throw new Error('Un autre passage conduit déjà le navigateur LinkedIn.');

    // Ne lève jamais : une page illisible rend une fiche aux champs nuls, que `enregistrerFichePost`
    // compte comme une tentative sans rien effacer.
    const fiche = await lireFichePost(pilote, ligne.url);
    await enregistrerFichePost(pool, job.organizationId, fiche, { fenetreJours: FENETRE_DECISION_JOURS });

    // Le sujet : seulement s'il n'y en a pas (un sujet de l'opérateur ne se remplace jamais).
    const texte = fiche.texte ?? ligne.text_excerpt;
    if (ligne.subject === null && texte !== null) {
      const sujet = await d.redacteur(texte).catch(() => null);
      if (sujet !== null) {
        await pool.query(
          `update linkedin_posts set subject = $3, subject_origin = 'model' /* jr:fiche_post_sujet */
            where organization_id = $1 and id = $2 and subject is null`,
          [job.organizationId, job.postId, sujet],
        );
      }
    }
  } finally {
    if (verrouPris) await prendreVerrouLinkedIn(ctx, proprietaire, 0).catch(() => false);
    if (pilote) await pilote.fermer().catch(() => undefined);
  }
}

/** Les dépendances réelles. Le rédacteur rend `null` jusqu'à la tâche 6. */
export function dependancesFichePostReelles(pool: Pool): DependancesFichePost {
  return {
    pool,
    env: process.env,
    ouvrirNavigateur: async () => (await import('../linkedin/navigateur.js')).ouvrirNavigateur(),
    releverSortie: async (p) => (await import('../linkedin/navigateur.js')).releverSortie(p),
    redacteur: async () => null,
  };
}

/**
 * Le rattrapage : enfile, par organisation à session active, les fiches incomplètes dans la limite
 * du plafond du jour. Retourne le nombre de jobs déposés.
 *
 * Le plafond compte les jobs de la file déposés AUJOURD'HUI (file active et archive, car pg-boss
 * archive un job terminé au bout de douze heures), dans le fuseau de l'organisation : une capture
 * échouée compte donc autant qu'une réussie, ce qui est voulu, puisque chacune a ouvert LinkedIn.
 * Un post déjà enfilé aujourd'hui n'est pas redéposé, pour la même raison.
 */
export async function enqueueFichesPostALire(boss: PgBoss, pool: Pool): Promise<number> {
  const orgs = await pool.query<{ organization_id: string }>(
    `select organization_id /* jr:fiche_post_organisations */
       from linkedin_server_sessions where status = 'active'`,
  );
  let enfiles = 0;
  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      const ctx: Contexte = { ex: pool, organisationId: organizationId, utilisateurId: null, role: null };
      const fuseau = await fuseauDeLOrganisation(pool, organizationId);
      const jour = jourCourantDansFuseau(fuseau);
      const plafond = await lirePlafondLinkedIn(ctx, 'linkedin_fiches_post_par_jour');
      const jobsDuJour = `
        select data->>'postId' as post_id from pgboss.job
         where name = $4 and data->>'organizationId' = $1::text
           and created_on >= ($2::date::timestamp at time zone $3)
        union all
        select data->>'postId' from pgboss.archive
         where name = $4 and data->>'organizationId' = $1::text
           and created_on >= ($2::date::timestamp at time zone $3)`;
      const dejaRes = await pool.query<{ n: number }>(
        `select count(*)::int as n /* jr:fiche_post_deja_enfiles */ from (${jobsDuJour}) t`,
        [organizationId, jour, fuseau, FILE],
      );
      const restants = plafond - (dejaRes.rows[0]?.n ?? 0);
      if (restants <= 0) continue;

      const candidats = await pool.query<{ id: string }>(
        `select p.id /* jr:fiche_post_candidates */
           from linkedin_posts p
          where p.organization_id = $1
            and p.capture_attempts < $5
            and p.expires_at > now()
            and (p.captured_at is null or p.author_name is null or p.text_excerpt is null or p.posted_at is null)
            and p.id::text not in (select post_id from (${jobsDuJour}) t where post_id is not null)
          order by p.capture_attempts, p.created_at desc
          limit $6`,
        [organizationId, jour, fuseau, FILE, TENTATIVES_MAX, restants],
      );
      for (const { id: postId } of candidats.rows) {
        await boss.insert([
          {
            name: FILE,
            id: deterministicUuid('fiche-post', postId, jour),
            data: { organizationId, postId },
            retryLimit: 2,
            retryBackoff: true,
          },
        ]);
        enfiles += 1;
      }
    } catch (err) {
      // Une organisation qui échoue n'emporte pas les autres. Seul le type d'erreur sort.
      console.error(
        `[fiche-post] enfilage impossible pour une organisation (${err instanceof Error ? err.name : 'erreur'})`,
      );
    }
  }
  return enfiles;
}

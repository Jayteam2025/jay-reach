/**
 * Les fiches de post en base (`linkedin_posts`) et le rattachement d'un signal à sa fiche.
 *
 * Une fiche par (organisation, post) : deux sources qui visent le même post la partagent, et ne
 * se distinguent que par `linkedin_posts_traites`. Le worker écrit avec la clé de service, donc
 * chaque requête filtre explicitement par organisation.
 *
 * UNE EXCEPTION, ET UNE SEULE : `rejeterFichesPostExpirees` écrit SANS filtre d'organisation.
 * C'est un balayage d'entretien, comme la purge de rétention : le terme de chaque fiche est déjà
 * inscrit dans son `expires_at`, posé avec la fenêtre de SON organisation, donc il n'y a rien à
 * relire et rien à cloisonner — une fiche échue l'est pour tout le monde. Dit ici parce que
 * c'est précisément l'endroit où un lecteur attend l'inverse.
 */
import { CLES_REGLAGES, normaliserUrlPost, plafondDuJour } from '@jay-reach/core';
import type { Pool } from 'pg';
import type { FichePost } from './fiche-post.js';
// Sens d'import inhabituel (un utilitaire LinkedIn qui lit le moteur), et assumé : c'est la SEULE
// façon de comparer la fenêtre de décision au délai d'ancienneté SANS recopier la lecture de
// `SIGNAL_MAX_AGE_DAYS`, et deux copies finiraient par diverger.
//
// MAIS CETTE LIGNE FERME UN CYCLE, et il est serré :
//   handlers/post-engagement.ts -> linkedin/posts-fiches.ts (ici) -> producer.ts -> post-engagement.ts
// Un cycle ne pardonne que le travail DIFFÉRÉ. Tout ce que `producer.ts` évalue AU CHARGEMENT en
// appelant un autre module explose en « is not a function » quand le module d'en face n'est pas
// encore initialisé — mesuré, symptôme et cause documentés sur `sqlPairesEligibles`
// (`producer.ts`). `AGE_MAX_SIGNAL_JOURS` ne pose pas de problème parce qu'il ne dépend que de
// l'environnement, et parce qu'il n'est lu qu'à l'intérieur d'une fonction, plus bas.
import { AGE_MAX_SIGNAL_JOURS } from '../producer.js';

const URN_ACTIVITE = /^urn:li:(?:activity|ugcPost|share):(\d+)$/;

/**
 * L'identité de comparaison d'un post, la même pour son adresse et pour son URN.
 * `normaliserUrlPost` ne sait pas lire un URN nu : on le ramène d'abord à `linkedin:<chiffres>`.
 */
export function clePost(urlOuUrn: string): string {
  const urn = URN_ACTIVITE.exec(urlOuUrn.trim());
  if (urn?.[1]) return `linkedin:${urn[1]}`;
  return normaliserUrlPost(urlOuUrn);
}

/**
 * Crée la fiche, ou la complète si elle existe.
 *
 * - un champ renseigné n'est jamais remplacé par un nul (une capture ratée ne défait pas la bonne) ;
 * - `subject`, `subject_origin` et la relecture ne sont pas touchés : un sujet posé par
 *   l'opérateur survit à toute nouvelle capture ;
 * - `expires_at` est posé à la création seulement ;
 * - `capture_attempts` compte chaque appel.
 */
export async function enregistrerFichePost(
  pool: Pool,
  organizationId: string,
  fiche: FichePost,
  opts: { fenetreJours: number },
): Promise<{ id: string; postKey: string; nouvelle: boolean }> {
  const postKey = clePost(fiche.urn ?? fiche.url);
  const a = fiche.auteur;
  const capture = a !== null || fiche.texte !== null || fiche.date !== null;
  const r = await pool.query<{ id: string; nouvelle: boolean }>(
    `insert into linkedin_posts
       (organization_id, post_key, post_urn, url, author_kind, author_name, author_display_name,
        author_public_name, author_url, posted_at, text_excerpt, expires_at, capture_attempts, captured_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             now() + make_interval(days => $12::int), 1, case when $13::boolean then now() end)
     on conflict (organization_id, post_key) do update set
       post_urn = coalesce(excluded.post_urn, linkedin_posts.post_urn),
       author_kind = coalesce(excluded.author_kind, linkedin_posts.author_kind),
       author_name = coalesce(excluded.author_name, linkedin_posts.author_name),
       author_display_name = coalesce(excluded.author_display_name, linkedin_posts.author_display_name),
       author_public_name = coalesce(excluded.author_public_name, linkedin_posts.author_public_name),
       author_url = coalesce(excluded.author_url, linkedin_posts.author_url),
       posted_at = coalesce(excluded.posted_at, linkedin_posts.posted_at),
       text_excerpt = coalesce(excluded.text_excerpt, linkedin_posts.text_excerpt),
       captured_at = coalesce(excluded.captured_at, linkedin_posts.captured_at),
       capture_attempts = linkedin_posts.capture_attempts + 1
     returning id, (xmax = 0) as nouvelle`,
    [
      organizationId,
      postKey,
      fiche.urn,
      fiche.url,
      a?.kind ?? null,
      a?.nom ?? null,
      // Une chaîne vide dit « pas de nom lisible » : elle ne s'écrit pas, un slug ne doit jamais s'afficher.
      a?.nomAffiche || null,
      a?.nomPublic ?? null,
      a?.url ?? null,
      fiche.date,
      fiche.texte,
      opts.fenetreJours,
      capture,
    ],
  );
  const ligne = r.rows[0];
  if (!ligne) throw new Error('enregistrerFichePost : aucune ligne rendue');
  return { id: ligne.id, postKey, nouvelle: ligne.nouvelle };
}

/** Rattache un signal à la fiche du post qui l'a fait naître. */
export async function rattacherSignalAuPost(
  pool: Pool,
  organizationId: string,
  signalId: string,
  postId: string,
): Promise<void> {
  await pool.query(`update signals set linkedin_post_id = $3 where organization_id = $1 and id = $2`, [
    organizationId,
    signalId,
    postId,
  ]);
}

/**
 * « Incomplète » : il manque l'auteur, le texte ou la date, le post ne peut pas encore être nommé.
 * UNE définition, en deux écritures qui doivent rester jumelles : `ficheIncomplete` (une ligne en
 * mémoire) et `SQL_FICHE_INCOMPLETE` (la même condition pour la sélection). Le harnais les compare
 * sur les huit combinaisons (contrôle 10e).
 */
export function ficheIncomplete(ligne: {
  author_name: string | null;
  text_excerpt: string | null;
  posted_at: Date | null;
}): boolean {
  return ligne.author_name === null || ligne.text_excerpt === null || ligne.posted_at === null;
}
export const SQL_FICHE_INCOMPLETE = '(p.author_name is null or p.text_excerpt is null or p.posted_at is null)';

/** Tentatives de capture au-delà desquelles une fiche n'est plus redemandée (un post supprimé ne se redemande pas). */
export const TENTATIVES_MAX = 3;

export type FicheARattraper = { id: string; url: string; text_excerpt: string | null; subject: string | null };

/**
 * Les fiches à rouvrir, au plus `limite` : incomplètes, sous le plafond de tentatives, dans leur
 * fenêtre. Les moins tentées d'abord, puis les plus récentes.
 */
export async function fichesARattraper(ex: Pick<Pool, 'query'>, organizationId: string, limite: number): Promise<FicheARattraper[]> {
  const r = await ex.query<FicheARattraper>(
    `select p.id, p.url, p.text_excerpt, p.subject /* jr:fiche_post_candidates */
       from linkedin_posts p
      where p.organization_id = $1
        and p.capture_attempts < $2
        and p.expires_at > now()
        and ${SQL_FICHE_INCOMPLETE}
      order by p.capture_attempts, p.created_at desc
      limit $3`,
    [organizationId, TENTATIVES_MAX, limite],
  );
  return r.rows;
}

/**
 * La fenêtre de décision d'une fiche, en jours, pour UNE organisation : le réglage
 * `linkedin_fenetre_validation_post_jours` (écran Réglages › LinkedIn), repli sur
 * `LINKEDIN_POST_REVIEW_WINDOW_DAYS` puis sur 28.
 *
 * Deux garde-fous ici, en plus de la validation à l'écriture (`schemaEcrireReglage`) :
 *
 *  - une valeur non entière ou nulle retombe sur le défaut. `expires_at = now() + 0 jour` ferait
 *    expirer chaque fiche à la seconde où elle naît : toutes rejetées, toutes les personnes
 *    purgées, sans un mot. Le repli d'environnement n'est validé par personne, donc la garde
 *    vit ici, à la lecture.
 *  - une fenêtre qui ne dépasse PAS le délai d'ancienneté des signaux est dite, sans être
 *    corrigée. La corriger en silence afficherait à l'écran un chiffre que le moteur n'applique
 *    pas ; la taire laisserait l'opérateur croire qu'il a jusqu'à l'échéance pour valider ses
 *    posts alors que la purge aura tout emporté avant.
 */
export async function fenetreValidationPost(ex: Pick<Pool, 'query'>, organizationId: string): Promise<number> {
  const brut = await plafondDuJour(ex, organizationId, 'linkedin_fenetre_validation_post_jours');
  const defaut = CLES_REGLAGES.find((r) => r.cle === 'linkedin_fenetre_validation_post_jours')!.defaut as number;
  const jours = Number.isFinite(brut) && brut > 0 ? Math.trunc(brut) : defaut;
  if (jours <= AGE_MAX_SIGNAL_JOURS) {
    console.warn(
      `[posts-fiches] fenêtre de validation (${jours} j) sous le délai d'ancienneté des signaux (${AGE_MAX_SIGNAL_JOURS} j) : les personnes seront effacées avant la validation de leur post`,
    );
  }
  return jours;
}

/**
 * Bascule en `rejected` les fiches `pending` dont la fenêtre est passée, et rend leur nombre.
 *
 * C'est ce qui referme la branche d'épargne : tant que la fiche est `pending` dans sa fenêtre,
 * les personnes qui ont réagi à ce post échappent à la purge d'ancienneté ; une fois la fenêtre
 * passée, elles y retombent. L'épargne a donc un terme, et ce terme est celui que l'écran
 * annonce.
 *
 * `reviewed_by` reste NUL, délibérément : c'est ce qui distingue un rejet d'expiration d'un rejet
 * prononcé par un humain. `reviewed_at` reste nul pour la même raison — personne n'a relu.
 *
 * Global, toutes organisations confondues : le terme est déjà inscrit dans `expires_at` de chaque
 * fiche, posé avec la fenêtre de SON organisation. Rien à relire ici.
 *
 * N'efface RIEN : seul le statut change. Ce sont la purge d'ancienneté et la purge de rétention
 * qui effacent, chacune avec ses propres gardes.
 */
export async function rejeterFichesPostExpirees(pool: Pool): Promise<number> {
  const r = await pool.query(
    `update linkedin_posts set review_status = 'rejected' /* jr:fiche_post_expiree */
      where review_status = 'pending' and expires_at <= now()`,
  );
  return r.rowCount ?? 0;
}

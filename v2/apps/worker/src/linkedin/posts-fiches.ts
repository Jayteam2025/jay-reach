/**
 * Les fiches de post en base (`linkedin_posts`) et le rattachement d'un signal à sa fiche.
 *
 * Une fiche par (organisation, post) : deux sources qui visent le même post la partagent, et ne
 * se distinguent que par `linkedin_posts_traites`. Le worker écrit avec la clé de service, donc
 * chaque requête filtre explicitement par organisation.
 */
import { normaliserUrlPost } from '@jay-reach/core';
import type { Pool } from 'pg';
import type { FichePost } from './fiche-post.js';

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

/** Vrai dès qu'il manque l'auteur, le texte ou la date : le post ne peut pas encore être nommé. */
export function ficheIncomplete(ligne: {
  author_name: string | null;
  text_excerpt: string | null;
  posted_at: Date | null;
}): boolean {
  return ligne.author_name === null || ligne.text_excerpt === null || ligne.posted_at === null;
}

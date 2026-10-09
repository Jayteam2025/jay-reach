/**
 * La mémoire des posts déjà collectés, par source.
 *
 * Voir `20261009110000_linkedin_posts_traites.sql` pour le pourquoi : sans elle, une source
 * suivie en continu relit les mêmes dix posts en tête de page à chaque passage.
 */
import type { Pool } from 'pg';

/** Ce qu'il faut pour interroger : un pool, ou la transaction en cours. */
export type Executeur = Pick<Pool, 'query'>;

/**
 * Les posts que CETTE source a déjà traités.
 *
 * Lu côté service, sur la table et jamais sur une vue : une vue soumise à RLS interrogée par un
 * pool sans session authentifiée rend zéro ligne sans lever la moindre erreur, et la collecte
 * croirait n'avoir jamais rien vu.
 */
export async function lirePostsTraites(ex: Executeur, organizationId: string, sourceId: string): Promise<Set<string>> {
  const r = await ex.query<{ post_urn: string }>(
    `select post_urn from linkedin_posts_traites where organization_id = $1 and source_id = $2`,
    [organizationId, sourceId],
  );
  return new Set(r.rows.map((l) => l.post_urn));
}

/**
 * Note qu'un post a été traité par cette source.
 *
 * Appelé APRÈS la lecture de ses engageurs, réussie ou non : un post qu'on a commencé à lire a
 * coûté son quota, et le relire au passage suivant le repaierait. Un post qui n'a produit aucun
 * engageur est justement celui qu'il ne faut pas rouvrir.
 */
export async function marquerPostTraite(
  ex: Executeur,
  organizationId: string,
  sourceId: string,
  postUrn: string,
): Promise<void> {
  await ex.query(
    `insert into linkedin_posts_traites (organization_id, source_id, post_urn)
     values ($1, $2, $3)
     on conflict (organization_id, source_id, post_urn) do nothing`,
    [organizationId, sourceId, postUrn],
  );
}

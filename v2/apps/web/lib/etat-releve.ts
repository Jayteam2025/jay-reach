/**
 * État de la relève des réponses, par fournisseur, pour l'écran Fournisseurs.
 *
 * Deux fournisseurs relèvent une boîte : SalesBlink, qui détecte les réponses
 * de son côté avec des heures de retard, et Microsoft Graph, qui lit la boîte
 * directement quand l'opérateur l'active. Les deux écrivent dans
 * `provider_sync_state` (`last_run_at`, `last_error`) ; un 403 de politique
 * d'accès Exchange, un secret expiré ou un tenant suspendu n'existent que là.
 * Sans cette lecture, l'erreur reste invisible et la relève a l'air de tourner.
 */

/** Fournisseurs dont `provider_sync_state` a un sens — les autres n'ont pas de relève. */
export const FOURNISSEURS_AVEC_RELEVE = ['salesblink', 'microsoft_graph'] as const;

export interface LigneEtatReleve {
  readonly provider: string;
  readonly last_run_at: string | null;
  readonly last_error: string | null;
}

export interface ResumeReleve {
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

/** Indexe les lignes lues en base par fournisseur (au plus une par fournisseur et par organisation). */
export function indexerEtatsReleve(lignes: readonly LigneEtatReleve[]): ReadonlyMap<string, LigneEtatReleve> {
  return new Map(lignes.map((ligne) => [ligne.provider, ligne]));
}

/**
 * Résumé à afficher sur la carte d'un fournisseur, ou `null` quand ce
 * fournisseur ne relève rien — auquel cas la carte n'affiche aucun état, même
 * si une ligne traînait en base.
 *
 * Un fournisseur qui relève mais n'a encore aucune ligne rend bien un résumé
 * (`lastRunAt` à `null`), pour que la carte dise « jamais » plutôt que de
 * rester muette : une relève qui n'a jamais tourné est exactement ce que
 * l'opérateur a besoin de voir.
 */
export function resumeReleve(
  etats: ReadonlyMap<string, LigneEtatReleve>,
  providerId: string,
): ResumeReleve | null {
  if (!(FOURNISSEURS_AVEC_RELEVE as readonly string[]).includes(providerId)) return null;
  const ligne = etats.get(providerId);
  return { lastRunAt: ligne?.last_run_at ?? null, lastError: ligne?.last_error ?? null };
}

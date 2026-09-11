/**
 * Contrat base minimal autorisé dans `packages/core` : ce paquet ne dépend pas
 * de `pg`, donc toute fonction qui touche la base y reçoit cette forme
 * structurelle plutôt qu'un `Pool`. Un `Pool` de `pg` la respecte déjà
 * (mêmes noms, mêmes formes de retour) : aucun adaptateur n'est nécessaire
 * côté appelant.
 */
export interface Executeur {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

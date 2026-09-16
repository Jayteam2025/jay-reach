/**
 * Réglages du transport SalesBlink saisis en texte libre dans l'écran Fournisseurs.
 * Rien n'est lu dans l'environnement : une valeur absente ou invalide retombe sur le
 * défaut, une valeur hors bornes est ramenée à la borne (décision JB du 10/09 : tous
 * les plafonds se règlent dans l'app).
 */
/**
 * Entier réglé en texte libre : une valeur absente ou invalide retombe sur le
 * défaut, une valeur hors bornes est ramenée à la borne. Exportée (tour de
 * correction 1, lot 3 bis) pour que `releve-graph.ts` la réutilise avec ses
 * propres bornes (1..60) plutôt que d'en recopier une variante locale.
 */
export function entierBorne(brut: string | null | undefined, defaut: number, min: number, max: number): number {
  if (brut === null || brut === undefined) return defaut;
  const texte = brut.trim();
  if (texte === '') return defaut;
  const valeur = Number(texte);
  if (!Number.isFinite(valeur)) return defaut;
  return Math.min(max, Math.max(min, Math.trunc(valeur)));
}

/** Minutes entre deux relèves SalesBlink : défaut 5, entre 2 et 60. */
export function normaliserIntervalleReleve(brut: string | null | undefined): number {
  return entierBorne(brut, 5, 2, 60);
}

/** Heures au-delà desquelles une relance `reply` non partie bascule sur la séquence d'étape : défaut 6, entre 1 et 72. */
export function normaliserDelaiRelanceMax(brut: string | null | undefined): number {
  return entierBorne(brut, 6, 1, 72);
}

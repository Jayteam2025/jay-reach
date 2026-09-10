/** Places restantes aujourd'hui. Un plafond nul, negatif ou invalide vaut pause : zero place. */
export function placesRestantes(plafond: number, consomme: number): number {
  if (!Number.isFinite(plafond) || plafond <= 0) return 0;
  const utilise = Number.isFinite(consomme) ? Math.max(0, consomme) : 0;
  return Math.max(0, plafond - utilise);
}

/** Reduit la taille d'un lot au reste disponible. */
export function reduireLotAuReste(lot: number, reste: number): number {
  return Math.max(0, Math.min(lot, reste));
}

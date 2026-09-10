/** Borne superieure d'un `int` Postgres (`daily_cap int`). */
const PLAFOND_MAX = 2_147_483_647;

/**
 * Normalise un plafond saisi en texte libre (champ `daily_cap` de l'ecran
 * Fournisseurs, `type: 'text'`) : absent, vide, negatif ou non numerique
 * retombe sur le defaut ; une valeur decimale est tronquee a l'entier ; une
 * valeur trop grande est bornee a ce qu'un `int` Postgres peut recevoir.
 * Zero reste zero (pause voulue).
 */
export function normaliserPlafond(brut: string | null | undefined, defaut: number): number {
  if (brut === null || brut === undefined) return defaut;
  const texte = brut.trim();
  if (texte === '') return defaut;
  const valeur = Number(texte);
  if (!Number.isFinite(valeur) || valeur < 0) return defaut;
  return Math.min(Math.trunc(valeur), PLAFOND_MAX);
}

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

/**
 * Repartit des lignes candidates sous le plafond de leur campagne, dans l'ordre recu.
 * `places` donne les places restantes par campagne ; `null` (ou une campagne absente) = sans limite.
 */
export function bornerParCampagne<T extends { campaign_id: string }>(
  lignes: readonly T[],
  places: ReadonlyMap<string, number | null>,
): { retenues: T[]; reportees: Map<string, number> } {
  const restant = new Map<string, number | null>(places);
  const retenues: T[] = [];
  const reportees = new Map<string, number>();
  for (const ligne of lignes) {
    const reste = restant.get(ligne.campaign_id);
    if (reste === null || reste === undefined) {
      retenues.push(ligne);
      continue;
    }
    if (reste > 0) {
      retenues.push(ligne);
      restant.set(ligne.campaign_id, reste - 1);
    } else {
      reportees.set(ligne.campaign_id, (reportees.get(ligne.campaign_id) ?? 0) + 1);
    }
  }
  return { retenues, reportees };
}

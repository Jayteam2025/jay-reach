/**
 * Logique d'affichage pure des jauges de plafond — séparée des écrans pour rester testable
 * sans next-intl ni App Router, même convention que `boite-affichage.ts`.
 *
 * UNE SEULE DÉFINITION pour les trois écrans qui montrent ces jauges (accueil, fiche de
 * campagne, Réglages › Plafonds). Avant la revue de cohérence du lot 2, chacun avait sa copie
 * de `tonJauge`/`pourcentageJauge` et deux d'entre eux affichaient le brut « 300 / 0 » : seul
 * Réglages traitait le zéro comme la pause qu'il est.
 *
 * Trois états, et pas deux :
 *   - `pause` — plafond à zéro (ou négatif, donnée invalide). `placesRestantes`
 *     (`@jay-reach/core`, `packages/core/src/plafonds.ts`) le dit sans ambiguïté : « Un plafond
 *     nul, negatif ou invalide vaut pause : zero place. » Zéro n'est jamais « illimité » ici.
 *   - `sansLimite` — aucun plafond réglé (`null`). Seuls les envois peuvent le rendre :
 *     `senders.daily_quota` est nullable, et le moteur lit ce NULL comme « aucune limite »
 *     (`quotaSenderRestant`, `apps/worker/src/handlers/sequence.ts`). L'afficher comme une
 *     pause faisait dire à l'écran l'inverse de ce que faisait le moteur.
 *   - `regle` — un plafond positif, le cas courant.
 */

/** L'état d'un plafond, tel que les gabarits ICU le sélectionnent (`select` sur `etat`). */
export type EtatPlafond = 'pause' | 'sansLimite' | 'regle';

export function etatDuPlafond(plafond: number | null): EtatPlafond {
  if (plafond === null) return 'sansLimite';
  return plafond <= 0 ? 'pause' : 'regle';
}

export interface ParametresValeurConsommation {
  utilise: number;
  plafond: number;
  etat: EtatPlafond;
  /** Index signature : passé tel quel à `t()` (next-intl, `TranslationValues`). */
  [cle: string]: string | number;
}

export function parametresValeurConsommation(utilise: number, plafond: number | null): ParametresValeurConsommation {
  // `plafond` reste un nombre pour ICU (un `null` interpolé afficherait « null ») ; c'est `etat`
  // qui porte le sens, et le gabarit `sansLimite` n'interpole pas la valeur.
  return { utilise, plafond: plafond ?? 0, etat: etatDuPlafond(plafond) };
}

export interface ParametresScoringTexte {
  plafond: number;
  enPause: 'oui' | 'non';
  /** Index signature : passé tel quel à `t()` (next-intl, `TranslationValues`). */
  [cle: string]: string | number;
}

/** Le plafond de scoring vient d'un réglage d'organisation : jamais `null`, donc deux états suffisent. */
export function parametresScoringTexte(plafond: number): ParametresScoringTexte {
  return { plafond, enPause: plafond <= 0 ? 'oui' : 'non' };
}

/**
 * Le ton de la barre. Sans limite réglée, il n'y a rien à dépasser : jamais d'alerte, quel que
 * soit le compteur. En pause, un compteur non nul est une anomalie (des envois sont partis alors
 * que le plafond les interdit) et mérite le ton d'erreur.
 */
export function tonJauge(utilise: number, plafond: number | null): 'normal' | 'attention' | 'erreur' {
  if (plafond === null) return 'normal';
  if (plafond <= 0) return utilise > 0 ? 'erreur' : 'normal';
  const pourcentage = (utilise / plafond) * 100;
  return pourcentage >= 100 ? 'erreur' : pourcentage >= 90 ? 'attention' : 'normal';
}

/** Remplissage de la barre. Sans plafond (absent ou nul), il n'y a pas de proportion à montrer : barre vide. */
export function pourcentageJauge(utilise: number, plafond: number | null): number {
  return plafond !== null && plafond > 0 ? Math.min(100, Math.round((utilise / plafond) * 100)) : 0;
}

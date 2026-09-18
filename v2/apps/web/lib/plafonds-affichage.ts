/**
 * Logique d'affichage pure de Réglages › Plafonds (constat recette du 18/09) — séparée de
 * `app/(app)/settings/limits/page.tsx` pour rester testable sans next-intl ni App Router, même
 * convention que `boite-affichage.ts`.
 *
 * `placesRestantes` (`@jay-reach/core`, `packages/core/src/plafonds.ts`) le dit sans ambiguïté :
 * « Un plafond nul, negatif ou invalide vaut pause : zero place. » Zéro n'est donc jamais
 * « illimité » dans ce produit — c'est la pause voulue. Le brut « 300 / 0 » (consommé aujourd'hui
 * / plafond) lisait comme un ratio absurde une fois le plafond retombé à zéro après coup ; ces
 * fonctions composent les paramètres ICU (`select` sur `enPause`) que les gabarits
 * `consommation.valeur`/`protection.scoringTexte` utilisent pour dire la vérité dans ce cas :
 * en pause, pas une limite infinie.
 */
export interface ParametresValeurConsommation {
  utilise: number;
  plafond: number;
  enPause: 'oui' | 'non';
  /** Index signature : passé tel quel à `t()` (next-intl, `TranslationValues`). */
  [cle: string]: string | number;
}

export function parametresValeurConsommation(utilise: number, plafond: number): ParametresValeurConsommation {
  return { utilise, plafond, enPause: plafond <= 0 ? 'oui' : 'non' };
}

export interface ParametresScoringTexte {
  plafond: number;
  enPause: 'oui' | 'non';
  /** Index signature : passé tel quel à `t()` (next-intl, `TranslationValues`). */
  [cle: string]: string | number;
}

export function parametresScoringTexte(plafond: number): ParametresScoringTexte {
  return { plafond, enPause: plafond <= 0 ? 'oui' : 'non' };
}

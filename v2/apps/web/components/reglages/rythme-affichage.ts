/**
 * Ce que l'écran montre pour le rythme d'envoi LinkedIn : quel cran le moteur applique, lequel
 * l'opérateur a sélectionné, et s'il reste quelque chose à écrire. Aucun React, aucune traduction
 * — même découpage que `boite-affichage.ts` et `compte-linkedin-affichage.ts`, pour que la règle
 * se teste sans DOM et que le composant ne fasse plus que du rendu.
 *
 * Le mot « appliqué » n'est pas « choisi » : `lireRythme` lit les valeurs réellement en vigueur,
 * donc une organisation qui n'a jamais rien réglé se lit « normal » sans que personne ne l'ait
 * décidé. L'écran peut dire ce qui s'applique, jamais ce que l'opérateur aurait choisi.
 */
import type { Rythme } from '@jay-reach/core';

export type CranRythme = Exclude<Rythme, 'personnalise'>;

export interface EtatCran {
  cle: CranRythme;
  /** Les valeurs en base correspondent à ce cran : c'est ce que le moteur fait aujourd'hui. */
  applique: boolean;
  /** L'opérateur a posé son choix ici ; rien n'est écrit tant qu'il n'a pas confirmé. */
  choisi: boolean;
}

export interface EtatChoixRythme {
  crans: EtatCran[];
  /**
   * Aucun cran ne correspond aux valeurs en base. Se dit AVANT les crans : sinon l'opérateur voit
   * trois cases vides et cherche l'explication après avoir cliqué.
   */
  surMesure: boolean;
  /** Le cran à écrire si l'opérateur confirme, ou `null` s'il n'y a rien à écrire. */
  aAppliquer: CranRythme | null;
}

/**
 * `selection` vaut `null` tant que l'opérateur n'a touché à rien : le cran appliqué est alors
 * marqué, mais aucun bouton n'apparaît. Choisir le cran déjà appliqué ne propose rien non plus —
 * réécrire les mêmes valeurs ne dirait rien à personne.
 */
export function etatChoixRythme(
  crans: readonly CranRythme[],
  applique: Rythme,
  selection: CranRythme | null,
): EtatChoixRythme {
  const aAppliquer = selection !== null && selection !== applique ? selection : null;
  return {
    crans: crans.map((cle) => ({
      cle,
      applique: cle === applique,
      choisi: selection !== null ? cle === selection : cle === applique,
    })),
    surMesure: applique === 'personnalise',
    aAppliquer,
  };
}

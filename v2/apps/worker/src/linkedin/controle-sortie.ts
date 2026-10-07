/**
 * Contrôle de sortie + observation, en un geste : chaque relève met à jour ce
 * que l'écran affiche (`last_egress_*`), qu'elle soit conforme ou non.
 *
 * La relève est injectée (`releverSortie(pilote)` de `navigateur.ts`) : ce
 * fichier n'importe pas le navigateur, donc rien ici ne tire `puppeteer-core`.
 */
import {
  enregistrerObservationSortie,
  verifierSortie,
  type Contexte,
  type Sortie,
} from '@jay-reach/core';

/**
 * Une relève qui échoue lève et n'écrit rien (aucune IP vue). Une relève non
 * conforme bloque la session (`verifierSortie`) ET consigne l'IP vue, pour que
 * l'écran montre laquelle.
 */
export async function controlerSortie(
  ctx: Contexte,
  attendue: string | null,
  releve: () => Promise<Sortie>,
): Promise<{ ok: boolean; sortie: Sortie }> {
  const resultat = await verifierSortie(ctx, attendue, releve);
  await enregistrerObservationSortie(ctx, resultat.sortie);
  return resultat;
}

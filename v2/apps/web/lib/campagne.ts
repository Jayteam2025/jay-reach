/**
 * `lireVueDEnsemble` mémoïsé pour la durée d'un rendu RSC — le layout de
 * campagne (en-tête, onglets) et sa page Vue d'ensemble appellent la même
 * fonction avec le même `Contexte`/`campagneId` : sans ce cache, chaque
 * navigation relirait deux fois les six requêtes de `lireVueDEnsemble`. Même
 * motif que `lireAujourdhuiCourant` (`lib/aujourdhui.ts`) : la mémoïsation
 * (React `cache`) reste ici, `packages/core` ne dépend pas de React.
 */
import { cache } from 'react';
import { lireVueDEnsemble, type Contexte, type VueDEnsemble } from '@jay-reach/core';

export const lireVueDEnsembleCourante = cache(
  (ctx: Contexte, campagneId: string): Promise<VueDEnsemble> => lireVueDEnsemble(ctx, { campagneId }),
);

/**
 * Badge de l'onglet Sources d'une campagne, ou `undefined` pour n'en montrer aucun (constat
 * recette du 18/09) : `nombreSources` (`compterSourcesCampagne`, `packages/core`) ne compte que
 * les lignes `campaign_sources` (Adzuna, France Travail, LinkedIn, annuaire) — une campagne à
 * liste (`origine === 'liste'`) n'en a par construction aucune, alimentée qu'elle est par sa
 * liste importée (`listeSource`, un mécanisme distinct). Un badge « 0 » y laissait croire à un
 * réglage manquant. L'onglet reste affiché (il sert aussi à rattacher une liste depuis
 * `TiroirSourceListe`) ; seul le compteur, qui n'a pas de sens pour ce type de campagne,
 * disparaît — même convention que `OngletItem.compteur` (`undefined` => pas de badge).
 */
export function compteurOngletSources(origine: 'sources' | 'liste', nombreSources: number): number | undefined {
  return origine === 'sources' ? nombreSources : undefined;
}

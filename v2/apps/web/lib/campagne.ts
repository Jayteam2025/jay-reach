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

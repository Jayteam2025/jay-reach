'use server';

/**
 * Façade fine sur `packages/core/src/fonctions/moteur.ts` pour l'écran
 * Réglages › Moteur (tâche 23) — même motif que `actions/campagne-reglages.ts` :
 * `contexteCourant()` + mapping d'erreurs, revalidation de la page.
 */
import { revalidatePath } from 'next/cache';
import { basculerPauseEnvoi, ErreurEntree, ForbiddenError, lancerTache } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille } from '../../lib/revalidation-layouts';

export type ResultatMoteur = { ok: true } | { ok: false; error: string };
export type ResultatLancerTache = { ok: true; sourcesDeclenchees: number } | { ok: false; error: string };

function resultatDErreur(err: unknown): { ok: false; error: string } {
  if (err instanceof ForbiddenError) return { ok: false, error: 'Droit insuffisant pour cette action.' };
  if (err instanceof ErreurEntree) return { ok: false, error: 'Entrée invalide.' };
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

export async function actionBasculerPauseEnvoi(pause: boolean): Promise<ResultatMoteur> {
  try {
    const ctx = await contexteCourant();
    await basculerPauseEnvoi(ctx, { pause });
    revalidatePath('/settings/engine');
    revalidatePath('/');
    // Carte Moteur de la barre latérale.
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionLancerTache(tache: string): Promise<ResultatLancerTache> {
  try {
    const ctx = await contexteCourant();
    const resultat = await lancerTache(ctx, { tache });
    revalidatePath('/settings/engine');
    // Carte Moteur de la barre latérale (dernier/prochain passage).
    revaliderCoquille();
    return { ok: true, sourcesDeclenchees: resultat.sourcesDeclenchees };
  } catch (err) {
    return resultatDErreur(err);
  }
}

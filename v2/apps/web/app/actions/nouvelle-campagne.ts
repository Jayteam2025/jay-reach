'use server';

/**
 * Façade fine sur `creerCampagneComplete` (packages/core/src/fonctions/assistant-campagne.ts)
 * pour l'assistant « Nouvelle campagne » (tâche 14) — même motif que
 * `campagne-reglages.ts` : le contexte vient de la session courante, jamais
 * d'un `organizationId` fourni par le client.
 */
import { revalidatePath } from 'next/cache';
import {
  creerCampagneComplete,
  ErreurConflit,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatNouvelleCampagne =
  | { ok: true; campagneId: string; lancee: boolean; manques: string[] }
  | { ok: false; error: string; issues?: string[] };

function resultatDErreur(err: unknown): ResultatNouvelleCampagne {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit insuffisant pour cette action.' };
  }
  if (err instanceof ErreurEntree) {
    const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
      (m): m is string => typeof m === 'string',
    );
    return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable || err instanceof ErreurConflit) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

export async function actionCreerCampagneComplete(input: unknown): Promise<ResultatNouvelleCampagne> {
  try {
    const ctx = await contexteCourant();
    const { campagneId, lancee, manques } = await creerCampagneComplete(ctx, input);
    revalidatePath('/campaigns');
    revalidatePath(`/campaigns/${campagneId}`);
    return { ok: true, campagneId, lancee, manques };
  } catch (err) {
    return resultatDErreur(err);
  }
}

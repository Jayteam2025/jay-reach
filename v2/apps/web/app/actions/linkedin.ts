'use server';

import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Réglages › Expéditeurs (tâche 20) — façade mince sur
// `packages/core/src/fonctions/expediteurs.ts` (spec « une fonction, deux
// façades »), pour la section « Comptes LinkedIn » de la page.
// ---------------------------------------------------------------------------
import {
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  listerComptesLinkedIn as listerComptesLinkedInCoeur,
  modifierCompteLinkedIn as modifierCompteLinkedInCoeur,
  type CompteLinkedIn,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatComptesLinkedIn<T = void> = { ok: true; valeur: T } | { ok: false; error: string };

function resultatDErreurLinkedIn<T>(err: unknown): ResultatComptesLinkedIn<T> {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (err instanceof ErreurEntree) {
    return { ok: false, error: 'Entrée invalide.' };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/** Comptes LinkedIn connectés (Réglages › Expéditeurs). */
export async function listerComptesLinkedInAction(): Promise<ResultatComptesLinkedIn<CompteLinkedIn[]>> {
  try {
    const ctx = await contexteCourant();
    const comptes = await listerComptesLinkedInCoeur(ctx);
    return { ok: true, valeur: comptes };
  } catch (err) {
    return resultatDErreurLinkedIn(err);
  }
}

/** Modifie un compte LinkedIn : activation du jeton visé, plafonds et fenêtre d'envoi partagés. */
export async function actionModifierCompteLinkedIn(entree: unknown): Promise<ResultatComptesLinkedIn> {
  try {
    const ctx = await contexteCourant();
    await modifierCompteLinkedInCoeur(ctx, entree);
    revalidatePath('/settings/senders');
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreurLinkedIn<void>(err);
  }
}

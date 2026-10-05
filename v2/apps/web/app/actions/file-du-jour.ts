'use server';

/**
 * Façade fine sur `reporterEnvoi`/`ecarterDuneCampagne`
 * (`packages/core/src/fonctions/file-du-jour.ts`, tâche 10) pour les boutons
 * Reporter/Écarter des onglets Contacts et File du jour d'une campagne, et
 * pour le tiroir « Relire avant envoi » (bouton Écarter) — même motif que
 * `campagne-cycle.ts` : un fichier séparé, pas un ajout à `campaigns.ts`.
 */
import { revalidatePath } from 'next/cache';
import { reporterEnvoi, ecarterDuneCampagne, relancerEnvoi, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille, revaliderLayoutCampagne } from '../../lib/revalidation-layouts';

export type ResultatFileDuJour = { ok: true } | { ok: false; error: string };

function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit opérateur requis.';
  if (err instanceof ErreurIntrouvable) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionReporterEnvoi(actionId: string, campagneId: string): Promise<ResultatFileDuJour> {
  try {
    const ctx = await contexteCourant();
    await reporterEnvoi(ctx, { actionId });
    revalidatePath(`/campaigns/${campagneId}/queue`);
    revalidatePath(`/campaigns/${campagneId}`);
    revaliderLayoutCampagne(campagneId);
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionEcarterDuneCampagne(contactId: string, campagneId: string): Promise<ResultatFileDuJour> {
  try {
    const ctx = await contexteCourant();
    await ecarterDuneCampagne(ctx, { contactId, campagneId });
    revalidatePath(`/campaigns/${campagneId}/queue`);
    revalidatePath(`/campaigns/${campagneId}/contacts`);
    revalidatePath(`/campaigns/${campagneId}`);
    revaliderLayoutCampagne(campagneId);
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

/**
 * Façade fine sur `relancerEnvoi` (R34, tour de correction 1) pour le bouton
 * « Réessayer » d'une ligne en échec de la file du jour (E3).
 */
export async function actionRelancerEnvoi(actionId: string, campagneId: string): Promise<ResultatFileDuJour> {
  try {
    const ctx = await contexteCourant();
    await relancerEnvoi(ctx, { actionId });
    revalidatePath(`/campaigns/${campagneId}/queue`);
    revalidatePath(`/campaigns/${campagneId}`);
    revaliderLayoutCampagne(campagneId);
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

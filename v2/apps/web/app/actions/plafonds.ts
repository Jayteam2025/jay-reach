'use server';

/**
 * Façade fine sur `ecrireReglage` (`packages/core/src/fonctions/plafonds.ts`)
 * pour l'écran Réglages › Plafonds (tâche 21) — même motif que
 * `actions/campagne-reglages.ts`.
 */
import { revalidatePath } from 'next/cache';
import { ecrireReglage, ErreurEntree, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille } from '../../lib/revalidation-layouts';

export type ResultatPlafond = { ok: true } | { ok: false; error: string };

function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit administrateur requis.';
  if (err instanceof ErreurEntree) {
    const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
      (m): m is string => typeof m === 'string',
    );
    return issues[0] ?? 'Entrée invalide.';
  }
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionEcrireReglage(cle: string, valeur: number | string): Promise<ResultatPlafond> {
  try {
    const ctx = await contexteCourant();
    await ecrireReglage(ctx, { cle, valeur });
    revalidatePath('/settings/limits');
    // Seul le fuseau est lu par le layout (bornes du jour de la jauge, heures de la carte Moteur) :
    // les autres réglages (scoring, enrichissement, âge des offres…) n'y apparaissent pas, et la
    // jauge de gauche suit les quotas des boîtes (`senders`), pas cette table.
    if (cle === 'fuseau') revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

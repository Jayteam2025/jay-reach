'use server';

import { revalidatePath } from 'next/cache';
import {
  activerSource,
  ajouterDepuisListe,
  creerSource,
  lancerPassage,
  modifierSource,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

// ---------------------------------------------------------------------------
// Onglet Sources d'UNE campagne (tâche 11, lot 2). Façade fine sur
// `packages/core/src/fonctions/sources.ts` : ces fonctions créent une source
// SCOPÉE à une campagne et passent par le `Contexte` de la session courante,
// jamais par un `organizationId` reçu du client.
// ---------------------------------------------------------------------------

export type ResultatSource = { ok: true } | { ok: false; error: string; issues?: string[] };
export type ResultatCreerSource =
  { ok: true; id: string } | { ok: false; error: string; issues?: string[] };
export type ResultatAjouterDepuisListe =
  { ok: true; ajoutes: number } | { ok: false; error: string; issues?: string[] };

function resultatDErreurSource(err: unknown): { ok: false; error: string; issues?: string[] } {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  if (err instanceof ErreurEntree) {
    const details = err.details as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const issues = [
      ...(details.formErrors ?? []),
      ...Object.values(details.fieldErrors ?? {}).flat(),
    ].filter((m): m is string => typeof m === 'string');
    return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

function revaliderOngletSources(campagneId: string): void {
  revalidatePath(`/campaigns/${campagneId}/sources`);
  revalidatePath(`/campaigns/${campagneId}`);
}

export async function actionCreerSource(
  campagneId: string,
  input: unknown,
): Promise<ResultatCreerSource> {
  try {
    const ctx = await contexteCourant();
    const entree =
      typeof input === 'object' && input !== null ? { ...input, campagneId } : { campagneId };
    const { id } = await creerSource(ctx, entree);
    revaliderOngletSources(campagneId);
    return { ok: true, id };
  } catch (err) {
    return resultatDErreurSource(err);
  }
}

export async function actionModifierSourceCampagne(
  campagneId: string,
  input: unknown,
): Promise<ResultatSource> {
  try {
    const ctx = await contexteCourant();
    await modifierSource(ctx, input);
    revaliderOngletSources(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreurSource(err);
  }
}

export async function actionActiverSourceCampagne(
  campagneId: string,
  sourceId: string,
  active: boolean,
): Promise<ResultatSource> {
  try {
    const ctx = await contexteCourant();
    await activerSource(ctx, { sourceId, active });
    revaliderOngletSources(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreurSource(err);
  }
}

export async function actionLancerPassageCampagne(
  campagneId: string,
  sourceId: string,
): Promise<ResultatSource> {
  try {
    const ctx = await contexteCourant();
    await lancerPassage(ctx, { sourceId });
    revaliderOngletSources(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreurSource(err);
  }
}

export async function actionAjouterDepuisListe(
  campagneId: string,
  input: unknown,
): Promise<ResultatAjouterDepuisListe> {
  try {
    const ctx = await contexteCourant();
    const entree =
      typeof input === 'object' && input !== null ? { ...input, campagneId } : { campagneId };
    const r = await ajouterDepuisListe(ctx, entree);
    revaliderOngletSources(campagneId);
    revalidatePath(`/campaigns/${campagneId}/contacts`);
    return { ok: true, ajoutes: r.ajoutes };
  } catch (err) {
    return resultatDErreurSource(err);
  }
}

'use server';

/**
 * Façade fine sur `modifierReglagesCampagne`/`archiver`
 * (packages/core/src/fonctions/campagnes.ts) pour l'onglet Réglages — même
 * motif que `actions/campagne-cycle.ts` (Lancer/Mettre en pause) : un
 * fichier séparé de `actions/campagns.ts`, hérité de l'ancien écran.
 */
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  archiver,
  ErreurConflit,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  modifierReglagesCampagne,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderLayoutCampagne } from '../../lib/revalidation-layouts';

export type ResultatReglagesCampagne = { ok: true } | { ok: false; error: string; issues?: string[] };

async function resultatDErreur(err: unknown): Promise<ResultatReglagesCampagne> {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit insuffisant pour cette action.' };
  }
  if (err instanceof ErreurEntree) {
    const details = err.details as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
      sourcesSansPersona?: Array<{ nom: string; cas: 'absent' | 'perime' }>;
    };
    if (details.sourcesSansPersona && details.sourcesSansPersona.length > 0) {
      // Une source d'engageurs bloque le changement de personas : on la nomme, dans la langue de l'opérateur.
      const t = await getTranslations('campagne.reglages.errors');
      const messages = details.sourcesSansPersona.map((b) =>
        t(b.cas === 'absent' ? 'personaSourceAbsent' : 'personaSourcePerime', { nom: b.nom }),
      );
      return { ok: false, error: 'Entrée invalide.', issues: messages };
    }
    const issues = [
      ...(details.formErrors ?? []),
      ...Object.values(details.fieldErrors ?? {}).flat(),
    ].filter((m): m is string => typeof m === 'string');
    return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable || err instanceof ErreurConflit) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

function revaliderOngletReglages(campagneId: string): void {
  revalidatePath(`/campaigns/${campagneId}/settings`);
  revalidatePath(`/campaigns/${campagneId}`);
  revalidatePath('/campaigns');
  revaliderLayoutCampagne(campagneId);
}

export async function actionModifierReglagesCampagne(
  campagneId: string,
  input: Record<string, unknown>,
): Promise<ResultatReglagesCampagne> {
  try {
    const ctx = await contexteCourant();
    await modifierReglagesCampagne(ctx, { ...input, campagneId });
    revaliderOngletReglages(campagneId);
    return { ok: true };
  } catch (err) {
    return await resultatDErreur(err);
  }
}

export async function actionArchiverCampagne(campagneId: string): Promise<ResultatReglagesCampagne> {
  try {
    const ctx = await contexteCourant();
    await archiver(ctx, { campagneId });
    revalidatePath('/campaigns');
    return { ok: true };
  } catch (err) {
    return await resultatDErreur(err);
  }
}

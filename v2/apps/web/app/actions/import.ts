'use server';

import { revalidatePath } from 'next/cache';

import { importerCsv, ErreurEntree, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

// ---------------------------------------------------------------------------
// Source « Fichier CSV » de l'onglet Sources d'une campagne (tâche 11, lot 2).
// Façade fine sur `importerCsv` (`packages/core/src/fonctions/sources.ts`) :
// toujours scopée à UNE campagne et passe par le `Contexte` de la session
// courante — les contacts entrent directement comme des personnes déjà
// qualifiées, sans scoring (maquette « tiroir-source-csv »).
// ---------------------------------------------------------------------------

export type ResultatImportCsvCampagne =
  | {
      ok: true;
      lignesLues: number;
      contactsNouveaux: number;
      dejaConnus: number;
      sansEmailValide: number;
    }
  | { ok: false; error: string; issues?: string[] };

export async function actionImporterCsvDansCampagne(
  campagneId: string,
  input: unknown,
): Promise<ResultatImportCsvCampagne> {
  try {
    const ctx = await contexteCourant();
    const entree =
      typeof input === 'object' && input !== null ? { ...input, campagneId } : { campagneId };
    const r = await importerCsv(ctx, entree);
    revalidatePath(`/campaigns/${campagneId}/sources`);
    revalidatePath(`/campaigns/${campagneId}/contacts`);
    revalidatePath(`/campaigns/${campagneId}`);
    revalidatePath('/contacts');
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'Droit opérateur requis.' };
    if (err instanceof ErreurEntree) {
      const details = err.details as {
        formErrors?: string[];
        fieldErrors?: Record<string, string[] | undefined>;
      };
      const issues = [
        ...(details.formErrors ?? []),
        ...Object.values(details.fieldErrors ?? {}).flat(),
      ].filter((m): m is string => typeof m === 'string');
      return {
        ok: false,
        error: 'Entrée invalide.',
        issues: issues.length > 0 ? issues : undefined,
      };
    }
    if (err instanceof ErreurIntrouvable) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

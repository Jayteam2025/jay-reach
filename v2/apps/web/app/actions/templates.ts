'use server';

import { revalidatePath } from 'next/cache';
import { enregistrerModele, ErreurEntree, ErreurIntrouvable, ForbiddenError, type CampaignNature } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

// ---------------------------------------------------------------------------
// Façades fines sur `packages/core/src/fonctions/messages.ts` (tâche 22,
// Réglages › Messages, la bibliothèque des modèles). `enregistrerModele`
// réutilise la fonction cœur `enregistrerVersionModele` mais résout la
// locale elle-même (R61) plutôt que de la demander à l'appelant.
// ---------------------------------------------------------------------------

export type ResultatEcritureModele =
  { ok: true; id: string } | { ok: false; error: string; issues?: string[] };

export interface ModeleEcritureInput {
  readonly familyId?: string | null;
  readonly nom: string;
  readonly canal: 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';
  readonly sujet?: string | null;
  readonly corps: string;
  readonly nature: CampaignNature;
}

function messageDErreurModele(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit administrateur requis.';
  if (err instanceof ErreurEntree) {
    const details = err.details as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const issues = [
      ...(details.formErrors ?? []),
      ...Object.values(details.fieldErrors ?? {}).flat(),
    ].filter((m): m is string => typeof m === 'string');
    return issues.length > 0 ? issues.join(' ') : 'Entrée invalide.';
  }
  if (err instanceof ErreurIntrouvable) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

/** Crée ou verse une nouvelle version d'un modèle de bibliothèque — admin requis (`enregistrerModele`). */
export async function actionEnregistrerModele(
  input: ModeleEcritureInput,
): Promise<ResultatEcritureModele> {
  try {
    const ctx = await contexteCourant();
    const { id } = await enregistrerModele(ctx, input);
    revalidatePath('/settings/messages');
    return { ok: true, id };
  } catch (err) {
    const details =
      err instanceof ErreurEntree
        ? (err.details as {
            formErrors?: string[];
            fieldErrors?: Record<string, string[] | undefined>;
          })
        : undefined;
    const issues = details
      ? [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
          (m): m is string => typeof m === 'string',
        )
      : undefined;
    return {
      ok: false,
      error: messageDErreurModele(err),
      issues: issues && issues.length > 0 ? issues : undefined,
    };
  }
}

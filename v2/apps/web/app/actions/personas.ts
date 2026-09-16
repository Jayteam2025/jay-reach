'use server';

import { revalidatePath } from 'next/cache';
import {
  enregistrerPersona,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  testerAppariement,
  type SenioritePersona,
  type TestAppariementResultat,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

// ---------------------------------------------------------------------------
// Façades fines sur `packages/core/src/fonctions/personas.ts` (tâche 22,
// Réglages › Personas).
// ---------------------------------------------------------------------------

export type ResultatEcriturePersona =
  { ok: true; id: string } | { ok: false; error: string; issues?: string[] };
export type ResultatTestAppariement =
  { ok: true; valeur: TestAppariementResultat } | { ok: false; error: string };

export interface PersonaEcritureInput {
  readonly id?: string;
  readonly nom: string;
  readonly intitulesPostes: string[];
  readonly seniorite: SenioritePersona | null;
  readonly consignesNotation: string | null;
  readonly ceQueJayApporte: string | null;
  readonly campagneParDefautId: string | null;
  readonly estActif?: boolean;
}

function messageDErreurPersona(err: unknown): string {
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

/** Crée (sans `id`) ou réécrit (avec) un persona — admin requis (`enregistrerPersona`). */
export async function actionEnregistrerPersona(
  input: PersonaEcritureInput,
): Promise<ResultatEcriturePersona> {
  try {
    const ctx = await contexteCourant();
    const { id } = await enregistrerPersona(ctx, input);
    revalidatePath('/settings/personas');
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: messageDErreurPersona(err) };
  }
}

/** Test d'appariement sur un intitulé saisi, contre les personas actifs de l'organisation (`testerAppariement`). */
export async function actionTesterAppariement(intitule: string): Promise<ResultatTestAppariement> {
  try {
    const ctx = await contexteCourant();
    const valeur = await testerAppariement(ctx, { intitule });
    return { ok: true, valeur };
  } catch (err) {
    return { ok: false, error: messageDErreurPersona(err) };
  }
}

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
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { contexteCourant } from '../../lib/contexte';

export type PersonaActionResult = { ok: true } | { ok: false; error: string };

export interface PersonaInput {
  readonly name: string;
  readonly description: string;
  readonly titlePatterns: string[];
  readonly titleExclusions: string[];
  readonly seniority: string | null;
  readonly scoringPrompt: string;
  readonly isActive: boolean;
}

function toRow(input: PersonaInput) {
  return {
    name: input.name.trim(),
    description: input.description.trim() || null,
    title_patterns: input.titlePatterns.filter((p) => p.trim().length > 0),
    title_exclusions: input.titleExclusions.filter((p) => p.trim().length > 0),
    seniority: input.seniority && input.seniority.length > 0 ? input.seniority : null,
    scoring_prompt: input.scoringPrompt.trim() || null,
    is_active: input.isActive,
  };
}

/** Crée un persona (admin requis). `titlePatterns` multilingues. */
export async function createPersona(
  organizationId: string,
  input: PersonaInput,
): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!input.name.trim()) {
    return { ok: false, error: 'Nom requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('personas')
    .insert({ organization_id: organizationId, ...toRow(input) });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/personas');
  return { ok: true };
}

/** Met à jour un persona existant (admin requis). */
export async function updatePersona(
  organizationId: string,
  id: string,
  input: PersonaInput,
): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!input.name.trim()) {
    return { ok: false, error: 'Nom requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('personas')
    .update(toRow(input))
    .eq('id', id)
    .eq('organization_id', organizationId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/personas');
  return { ok: true };
}

/** Supprime un persona (admin requis). */
export async function deletePersona(
  organizationId: string,
  id: string,
): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('personas')
    .delete()
    .eq('id', id)
    .eq('organization_id', organizationId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/personas');
  return { ok: true };
}

/** Active/désactive un persona (admin requis). */
export async function togglePersonaActive(
  organizationId: string,
  id: string,
  active: boolean,
): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('personas')
    .update({ is_active: active })
    .eq('id', id)
    .eq('organization_id', organizationId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/personas');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Façades fines sur `packages/core/src/fonctions/personas.ts` (tâche 22,
// Réglages › Personas). Les quatre fonctions ci-dessus (`createPersona` et
// consorts) restent celles de l'ancien écran (`persona-board.tsx`), orphelin
// depuis que `settings/personas/page.tsx` a été reconstruite d'après la
// maquette — nettoyage laissé à la tâche 24, même geste que
// `senders-form.tsx` (tâche 20).
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

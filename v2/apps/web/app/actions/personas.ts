'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type PersonaActionResult = { ok: true } | { ok: false; error: string };

export interface PersonaInput {
  readonly name: string;
  readonly description: string;
  readonly titlePatterns: string[];
  readonly titleExclusions: string[];
  readonly seniority: string | null;
  readonly channels: string[];
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
    channels_priority: input.channels.length > 0 ? input.channels : ['email'],
    scoring_prompt: input.scoringPrompt.trim() || null,
    is_active: input.isActive,
  };
}

/** Crée un persona (admin requis). `titlePatterns` multilingues. */
export async function createPersona(organizationId: string, input: PersonaInput): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!input.name.trim()) {
    return { ok: false, error: 'Nom requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('personas').insert({ organization_id: organizationId, ...toRow(input) });
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
export async function deletePersona(organizationId: string, id: string): Promise<PersonaActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('personas').delete().eq('id', id).eq('organization_id', organizationId);
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

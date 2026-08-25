'use server';

import { revalidatePath } from 'next/cache';
import { validateTemplateVariables, type CampaignNature } from '@jay-reach/core';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

/** Canaux qui portent un corps de message éditable. */
export type TemplateChannel = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter';

export interface TemplateVersionInput {
  /** Lignée existante à versionner, ou null/undefined pour créer une nouvelle famille. */
  readonly familyId?: string | null;
  readonly name: string;
  readonly channel: TemplateChannel;
  readonly locale: string;
  readonly subject?: string | null;
  readonly body: string;
  /** Nature de campagne visée : décide des variables disponibles à la validation. */
  readonly nature: CampaignNature;
}

export type TemplateSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; issues?: string[] };

/**
 * Enregistre une NOUVELLE version d'un template (jamais en place, spec §7). Valide
 * d'abord les variables (règle #2 : refus à l'enregistrement d'une variable
 * indisponible/inconnue ou d'un repli interdit), puis délègue à la RPC atomique
 * qui numérote la version et bascule l'active.
 */
export async function saveTemplateVersion(
  organizationId: string,
  input: TemplateVersionInput,
): Promise<TemplateSaveResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!input.name.trim()) return { ok: false, error: 'Nom requis.' };
  if (!input.body.trim()) return { ok: false, error: 'Message requis.' };

  const issues = validateTemplateVariables(input.body, input.nature);
  if (issues.length > 0) {
    return { ok: false, error: 'Variables invalides.', issues: issues.map((i) => i.message) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_message_template_version', {
    p_org: organizationId,
    p_family: input.familyId ?? null,
    p_name: input.name.trim(),
    p_channel: input.channel,
    p_locale: input.locale,
    p_subject: input.subject?.trim() ? input.subject.trim() : null,
    p_body: input.body,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/templates');
  return { ok: true, id: String(data) };
}

/** Retour arrière : réactive une version antérieure (désactive l'autre active). */
export async function activateTemplateVersion(
  organizationId: string,
  versionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('activate_message_template_version', { p_id: versionId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/templates');
  return { ok: true };
}

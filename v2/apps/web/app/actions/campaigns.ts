'use server';

import { revalidatePath } from 'next/cache';
import {
  parseCampaignCreate,
  parseCampaignSettings,
  parseStep,
  campaignStatusSchema,
  toEntryRules,
  toStepConditions,
  type CampaignStatus,
} from '@jay-reach/core';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type CampaignActionResult = { ok: true; id: string } | { ok: false; error: string; issues?: string[] };
export type SimpleResult = { ok: true } | { ok: false; error: string; issues?: string[] };

async function asAdmin(organizationId: string): Promise<SimpleResult> {
  try {
    await requireRole(organizationId, 'admin');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
}

/** Crée une campagne (brouillon) adossée à UNE source OU UNE liste. */
export async function createCampaign(organizationId: string, input: unknown): Promise<CampaignActionResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const parsed = parseCampaignCreate(input);
  if (!parsed.ok) return { ok: false, error: 'Entrée invalide.', issues: parsed.errors };
  const { name, entryKind, entryId, minScore, personaIds, dailyCap } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organization_id: organizationId,
      name,
      status: 'draft',
      source_id: entryKind === 'source' ? entryId : null,
      list_id: entryKind === 'list' ? entryId : null,
      entry_rules: toEntryRules({ minScore, personaIds }),
      daily_cap: dailyCap ?? null,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/campaigns');
  return { ok: true, id: data.id as string };
}

/** Met à jour nom / plafond / règles d'entrée d'une campagne. */
export async function updateCampaignSettings(
  organizationId: string,
  campaignId: string,
  input: unknown,
): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const parsed = parseCampaignSettings(input);
  if (!parsed.ok) return { ok: false, error: 'Entrée invalide.', issues: parsed.errors };
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.dailyCap !== undefined) patch.daily_cap = parsed.data.dailyCap;
  if (parsed.data.minScore !== undefined || parsed.data.personaIds !== undefined) {
    patch.entry_rules = toEntryRules({ minScore: parsed.data.minScore, personaIds: parsed.data.personaIds });
  }
  const supabase = await createClient();
  const { error } = await supabase.from('campaigns').update(patch).eq('id', campaignId).eq('organization_id', organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** Change le statut d'une campagne (brouillon / active / en pause / archivée). */
export async function setCampaignStatus(organizationId: string, campaignId: string, status: string): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const s = campaignStatusSchema.safeParse(status);
  if (!s.success) return { ok: false, error: 'Statut invalide.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update({ status: s.data as CampaignStatus })
    .eq('id', campaignId)
    .eq('organization_id', organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** Ajoute une étape en fin de séquence. */
export async function addStep(organizationId: string, campaignId: string, input: unknown): Promise<CampaignActionResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const parsed = parseStep(input);
  if (!parsed.ok) return { ok: false, error: 'Entrée invalide.', issues: parsed.errors };
  const supabase = await createClient();
  const last = await supabase
    .from('sequence_steps')
    .select('position')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = ((last.data?.[0]?.position as number | undefined) ?? -1) + 1;
  const { data, error } = await supabase
    .from('sequence_steps')
    .insert({
      campaign_id: campaignId,
      position: nextPos,
      channel: parsed.data.channel,
      delay_hours: parsed.data.delayHours,
      template_parent_id: parsed.data.templateParentId ?? null,
      conditions: toStepConditions(parsed.data.condition),
      stop_on: parsed.data.stopOn ?? [],
      call_brief: parsed.data.callBrief ?? null,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, id: data.id as string };
}

/** Met à jour une étape existante. */
export async function updateStep(
  organizationId: string,
  campaignId: string,
  stepId: string,
  input: unknown,
): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const parsed = parseStep(input);
  if (!parsed.ok) return { ok: false, error: 'Entrée invalide.', issues: parsed.errors };
  const supabase = await createClient();
  const { error } = await supabase
    .from('sequence_steps')
    .update({
      channel: parsed.data.channel,
      delay_hours: parsed.data.delayHours,
      template_parent_id: parsed.data.templateParentId ?? null,
      conditions: toStepConditions(parsed.data.condition),
      stop_on: parsed.data.stopOn ?? [],
      call_brief: parsed.data.callBrief ?? null,
    })
    .eq('id', stepId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** Supprime une étape. */
export async function deleteStep(organizationId: string, campaignId: string, stepId: string): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.from('sequence_steps').delete().eq('id', stepId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** Déplace une étape vers le haut ou le bas (swap atomique via RPC). */
export async function moveStep(
  organizationId: string,
  campaignId: string,
  stepId: string,
  up: boolean,
): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_sequence_step', { p_step: stepId, p_up: up });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

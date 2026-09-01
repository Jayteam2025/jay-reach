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

/**
 * Crée une campagne (brouillon), adossée à un ou plusieurs thèmes de veille, ou
 * à une liste.
 *
 * `campaigns.source_id` reste renseigné avec le premier thème : la colonne est
 * dépréciée mais lue par du code encore en place, et la vider d'un coup ferait
 * disparaître l'entrée de campagnes qui fonctionnent.
 */
export async function createCampaign(organizationId: string, input: unknown): Promise<CampaignActionResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const parsed = parseCampaignCreate(input);
  if (!parsed.ok) return { ok: false, error: 'Entrée invalide.', issues: parsed.errors };
  const { name, entryKind, entryId, sourceIds, minScore, personaIds, dailyCap } = parsed.data;

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

  const campaignId = data.id as string;
  const themes = entryKind === 'source' ? (sourceIds ?? [entryId]) : [];
  if (themes.length > 0) {
    const { error: erreurThemes } = await supabase
      .from('campaign_sources')
      .insert(themes.map((source_id) => ({ campaign_id: campaignId, source_id })));
    if (erreurThemes) return { ok: false, error: erreurThemes.message };
  }

  revalidatePath('/campaigns');
  return { ok: true, id: campaignId };
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

  // Même contrôle qu'à l'activation : élargir les personas d'une campagne déjà
  // active peut créer la collision aussi sûrement que l'activer.
  if (parsed.data.personaIds !== undefined && parsed.data.personaIds.length > 0) {
    const { data: etat } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', campaignId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if ((etat as { status?: string } | null)?.status === 'active') {
      const collision = await chercherCollisionDePersona(supabase, organizationId, campaignId, parsed.data.personaIds);
      if (collision) return { ok: false, error: collision };
    }
  }
  const { error } = await supabase.from('campaigns').update(patch).eq('id', campaignId).eq('organization_id', organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/**
 * Une persona ne peut être servie que par une campagne active à la fois, sur un
 * même thème de veille.
 *
 * Sans cette règle, le producteur d'inscription doit arbitrer entre deux
 * destinations pour le même contact : il en choisirait une, silencieusement, et
 * l'opérateur découvrirait des mois plus tard que la moitié de ses prospects
 * partaient dans la mauvaise campagne.
 *
 * Une contrainte en base ne peut pas exprimer ça — elle traverserait
 * `campaigns`, `campaign_sources` et le contenu d'un jsonb. C'est donc à
 * l'application de la tenir, au moment précis où la collision devient réelle :
 * l'activation, et le changement de personas d'une campagne déjà active.
 *
 * Renvoie le message à afficher, ou `null` si la voie est libre.
 */
async function chercherCollisionDePersona(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  campaignId: string,
  personaIds: readonly string[],
): Promise<string | null> {
  if (personaIds.length === 0) return null;

  // Thèmes de cette campagne : ceux de la table de liaison, plus le thème
  // direct que la colonne dépréciée porte encore.
  const { data: liens } = await supabase
    .from('campaign_sources')
    .select('source_id')
    .eq('campaign_id', campaignId);
  const { data: courante } = await supabase
    .from('campaigns')
    .select('source_id')
    .eq('id', campaignId)
    .maybeSingle();
  const themes = new Set<string>([
    ...((liens ?? []) as { source_id: string }[]).map((l) => l.source_id),
    ...((courante as { source_id: string | null } | null)?.source_id ? [(courante as { source_id: string }).source_id] : []),
  ]);
  if (themes.size === 0) return null;

  const { data: autres } = await supabase
    .from('campaigns')
    .select('id, name, entry_rules, source_id, campaign_sources(source_id)')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .neq('id', campaignId);

  for (const autre of (autres ?? []) as {
    id: string;
    name: string;
    entry_rules: { personas?: string[] } | null;
    source_id: string | null;
    campaign_sources: { source_id: string }[] | null;
  }[]) {
    const themesAutre = new Set<string>([
      ...(autre.campaign_sources ?? []).map((l) => l.source_id),
      ...(autre.source_id ? [autre.source_id] : []),
    ]);
    const themeCommun = [...themes].some((t) => themesAutre.has(t));
    if (!themeCommun) continue;

    const partagee = (autre.entry_rules?.personas ?? []).find((p) => personaIds.includes(p));
    if (partagee) {
      return `La campagne « ${autre.name} » est déjà active sur le même thème pour cette persona. Mettez-la en pause, ou retirez la persona de l’une des deux.`;
    }
  }
  return null;
}

/** Change le statut d'une campagne (brouillon / active / en pause / archivée). */
export async function setCampaignStatus(organizationId: string, campaignId: string, status: string): Promise<SimpleResult> {
  const auth = await asAdmin(organizationId);
  if (!auth.ok) return auth;
  const s = campaignStatusSchema.safeParse(status);
  if (!s.success) return { ok: false, error: 'Statut invalide.' };
  const supabase = await createClient();

  if (s.data === 'active') {
    const { data: reglesActuelles } = await supabase
      .from('campaigns')
      .select('entry_rules')
      .eq('id', campaignId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    const personas = ((reglesActuelles as { entry_rules?: { personas?: string[] } } | null)?.entry_rules?.personas) ?? [];
    const collision = await chercherCollisionDePersona(supabase, organizationId, campaignId, personas);
    if (collision) return { ok: false, error: collision };
  }

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

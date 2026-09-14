'use server';

import { revalidatePath } from 'next/cache';
import {
  parseStep,
  toStepConditions,
  campaignStatusSchema,
  creerCampagne,
  modifierReglagesCampagne,
  lancer,
  mettreEnPause,
  archiver,
  exiger,
  ErreurEntree,
  ErreurIntrouvable,
  ErreurConflit,
  ForbiddenError,
} from '@jay-reach/core';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { contexteCourant } from '../../lib/contexte';

export type CampaignActionResult = { ok: true; id: string } | { ok: false; error: string; issues?: string[] };
export type SimpleResult = { ok: true } | { ok: false; error: string; issues?: string[] };

/**
 * Traduit une erreur des fonctions de `packages/core/src/fonctions/campagnes.ts`
 * en résultat de façade — jamais une exception qui ferait tomber la Server
 * Action (les anciennes actions renvoyaient toutes un `SimpleResult`, jamais
 * une exception non attrapée).
 */
function resultatDErreur(err: unknown): { ok: false; error: string; issues?: string[] } {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit insuffisant pour cette action.' };
  }
  if (err instanceof ErreurEntree) {
    const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
      (m): m is string => typeof m === 'string',
    );
    return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable || err instanceof ErreurConflit) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/**
 * Crée une campagne (brouillon), adossée à un ou plusieurs thèmes de veille, ou
 * à une liste. Façade fine : le contexte vient de la session courante,
 * JAMAIS de `organizationId` — un id d'organisation reçu du client n'a
 * aucune valeur d'autorisation, il ne sert plus qu'à vérifier qu'il coïncide
 * avec l'organisation réellement courante (sinon la Server Action ne fait
 * rien).
 */
export async function createCampaign(organizationId: string, input: unknown): Promise<CampaignActionResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    const { id } = await creerCampagne(ctx, input);
    revalidatePath('/campaigns');
    return { ok: true, id };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/** Met à jour nom / plafond / règles d'entrée d'une campagne. */
export async function updateCampaignSettings(
  organizationId: string,
  campaignId: string,
  input: unknown,
): Promise<SimpleResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    const entree = typeof input === 'object' && input !== null ? { ...input, campagneId: campaignId } : { campagneId: campaignId };
    await modifierReglagesCampagne(ctx, entree);
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/**
 * Change le statut d'une campagne (brouillon / active / en pause / archivée).
 * Délègue à `lancer`/`mettreEnPause`/`archiver` (packages/core), qui portent
 * désormais la garde d'activation, la collision de persona et le journal
 * d'activité — cette façade ne fait plus qu'aiguiller et traduire l'erreur.
 */
export async function setCampaignStatus(organizationId: string, campaignId: string, status: string): Promise<SimpleResult> {
  const s = campaignStatusSchema.safeParse(status);
  if (!s.success) return { ok: false, error: 'Statut invalide.' };

  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }

    if (s.data === 'active') {
      const r = await lancer(ctx, { campagneId: campaignId });
      if (!r.ok) {
        return { ok: false, error: `Cette campagne ne peut rien envoyer en l’état : ${r.manques.join(' ; ')}.` };
      }
    } else if (s.data === 'paused') {
      await mettreEnPause(ctx, { campagneId: campaignId });
    } else if (s.data === 'archived') {
      await archiver(ctx, { campagneId: campaignId });
    } else {
      // 'draft' : aucun écran ne repasse une campagne en brouillon aujourd'hui, et le brief de
      // cette tâche ne définit pas de fonction dédiée — mise à jour minimale conservée pour ne
      // pas faire régresser un appel existant à ce statut.
      exiger(ctx, 'operator');
      await ctx.ex.query(`update campaigns set status = 'draft' where id = $1 and organization_id = $2`, [campaignId, organizationId]);
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

async function asAdmin(organizationId: string): Promise<SimpleResult> {
  try {
    await requireRole(organizationId, 'admin');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
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

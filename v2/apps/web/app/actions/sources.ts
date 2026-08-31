'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { SOURCE_PROVIDERS, type SourceProvider, type SourceInput } from '../../lib/sources';

export type SourceActionResult = { ok: true } | { ok: false; error: string };

/**
 * Assemble le `config` jsonb de la source. Le prompt et le seuil y vivent avec
 * les mots-clés : le scoring les lit depuis la source du signal, et une source
 * sans prompt est ignorée par le scoring — les séparer créerait un état
 * incohérent qu'aucun écran ne montrerait.
 */
function toConfig(input: SourceInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    keywords: input.keywords.map((k) => k.trim()).filter((k) => k.length > 0),
  };
  if (input.location.trim()) config.location = input.location.trim();
  if (input.scoringPrompt.trim()) config.scoring_prompt = input.scoringPrompt.trim();
  if (Number.isFinite(input.matchThreshold)) config.match_threshold = input.matchThreshold;
  return config;
}

function valider(input: SourceInput): string | null {
  if (!input.name.trim()) return 'Nom requis.';
  const inconnu = input.providerIds.find((p) => !SOURCE_PROVIDERS.includes(p as SourceProvider));
  if (inconnu) {
    return `Provider inconnu : ${inconnu}`;
  }
  if (input.keywords.filter((k) => k.trim()).length === 0) {
    return 'Au moins un mot-clé est requis, sinon la source n’a rien à chercher.';
  }
  if (input.matchThreshold < 0 || input.matchThreshold > 100) {
    return 'Le seuil doit être compris entre 0 et 100.';
  }
  return null;
}

/**
 * Aligne les fournisseurs rattachés au thème sur ceux demandés.
 *
 * Un fournisseur retiré est *désactivé*, jamais supprimé : les exécutions
 * passées y font référence, et les effacer ferait disparaître l'historique de
 * collecte au moment précis où on cherche à comprendre ce qui a changé.
 */
async function synchroniserFournisseurs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  providerIds: readonly string[],
): Promise<string | null> {
  const demandes = [...new Set(providerIds)];

  if (demandes.length > 0) {
    const { error } = await supabase.from('source_providers').upsert(
      demandes.map((provider_id) => ({ source_id: sourceId, provider_id, is_active: true })),
      { onConflict: 'source_id,provider_id' },
    );
    if (error) return error.message;
  }

  const { data: existants, error: erreurLecture } = await supabase
    .from('source_providers')
    .select('id, provider_id')
    .eq('source_id', sourceId);
  if (erreurLecture) return erreurLecture.message;

  const aDesactiver = ((existants ?? []) as { id: string; provider_id: string }[])
    .filter((r) => !demandes.includes(r.provider_id))
    .map((r) => r.id);

  if (aDesactiver.length > 0) {
    const { error } = await supabase.from('source_providers').update({ is_active: false }).in('id', aDesactiver);
    if (error) return error.message;
  }
  return null;
}

/** Crée un thème de veille (admin requis). */
export async function createSource(organizationId: string, input: SourceInput): Promise<SourceActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const invalide = valider(input);
  if (invalide) return { ok: false, error: invalide };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sources')
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      description: input.description.trim() || null,
      config: toConfig(input),
      schedule: 'daily',
      is_active: input.isActive,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  const echec = await synchroniserFournisseurs(supabase, (data as { id: string }).id, input.providerIds);
  if (echec) return { ok: false, error: echec };

  revalidatePath('/settings/sources');
  return { ok: true };
}

/** Met à jour un thème de veille existant (admin requis). */
export async function updateSource(
  organizationId: string,
  sourceId: string,
  input: SourceInput,
): Promise<SourceActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const invalide = valider(input);
  if (invalide) return { ok: false, error: invalide };

  const supabase = await createClient();
  const { error } = await supabase
    .from('sources')
    .update({
      name: input.name.trim(),
      description: input.description.trim() || null,
      config: toConfig(input),
      is_active: input.isActive,
    })
    .eq('id', sourceId)
    .eq('organization_id', organizationId);
  if (error) return { ok: false, error: error.message };

  const echec = await synchroniserFournisseurs(supabase, sourceId, input.providerIds);
  if (echec) return { ok: false, error: echec };

  revalidatePath('/settings/sources');
  return { ok: true };
}

/**
 * Demande une collecte immédiate. On ne fait que poser l'horodatage : le worker
 * relève la demande et l'enfile. L'application ne connaît pas la file de jobs,
 * et lui ajouter cette dépendance pour un bouton reviendrait à en dupliquer la
 * moitié.
 */
export async function requestSourceRun(organizationId: string, sourceId: string): Promise<SourceActionResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('sources')
    .update({ run_requested_at: new Date().toISOString() })
    .eq('id', sourceId)
    .eq('organization_id', organizationId)
    .eq('is_active', true);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/sources');
  return { ok: true };
}

/** Active ou met en pause une source (admin requis). */
export async function toggleSource(
  organizationId: string,
  sourceId: string,
  isActive: boolean,
): Promise<SourceActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('sources')
    .update({ is_active: isActive })
    .eq('id', sourceId)
    .eq('organization_id', organizationId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/sources');
  return { ok: true };
}

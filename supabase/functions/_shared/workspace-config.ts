/**
 * Loader de la config workspace prospection (Jay Reach dé-hardcoding PR1).
 *
 * Source unique de vérité pour les PR2-5 : signal_triggers (comment scraper)
 * + icp_personas (qui contacter). Fail-fast sans fallback Jay (même
 * philosophie que workspace-brand.ts) : config absente => WorkspaceConfigError
 * avec message actionnable, jamais de valeurs par défaut métier.
 *
 * Cache : Maps module-level, qui
 * survivent aux invocations successives d'un isolate Deno CHAUD — pas
 * seulement « par exécution ». Une édition de config dans l'UI peut donc
 * être servie en différé jusqu'au cold start de l'isolate. Choix assumé :
 * les consommateurs (PR2-5) sont des batchs/crons qui relisent la config
 * des dizaines de fois par run (contrairement à workspace-brand.ts, lu une
 * fois, donc sans cache). Pour forcer un rechargement dans un long-running,
 * utiliser clearWorkspaceConfigCache().
 *
 * Point unique à rebrancher lors de l'extraction Phase 2 (packages/core).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  mapPersonaRow,
  mapTriggerRow,
  WorkspaceConfigError,
  type PersonaConfig,
  type TriggerConfig,
} from './workspace-config-core.ts';

export { WorkspaceConfigError };
export type { PersonaConfig, TriggerConfig };

const personasCache = new Map<string, PersonaConfig[]>();
const triggerCache = new Map<string, TriggerConfig>();

/**
 * Charge les personas ACTIFS d'un workspace, triés défaut d'abord.
 * Throw WorkspaceConfigError('no_active_personas') si aucun : un pipeline
 * sans persona ne doit jamais tourner en silence.
 */
export async function loadActivePersonas(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<PersonaConfig[]> {
  const cached = personasCache.get(workspaceId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('icp_personas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('slug', { ascending: true });

  if (error) {
    throw new WorkspaceConfigError(
      'personas_load_failed',
      `Lecture icp_personas impossible (workspace ${workspaceId}): ${error.message}`,
    );
  }

  const personas = (data ?? []).map((row) => mapPersonaRow(row as Record<string, unknown>));
  if (personas.length === 0) {
    throw new WorkspaceConfigError(
      'no_active_personas',
      `Aucun persona actif pour le workspace ${workspaceId} — configurez vos personas dans Prospection > Config > Personas`,
    );
  }

  personasCache.set(workspaceId, personas);
  return personas;
}

/**
 * Charge un trigger par id. Throw si introuvable (un signal qui référence un
 * trigger supprimé doit être skippé avec une raison explicite, pas scoré
 * avec un défaut).
 */
export async function loadTriggerConfig(
  supabase: SupabaseClient,
  triggerId: string,
): Promise<TriggerConfig> {
  const cached = triggerCache.get(triggerId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('signal_triggers')
    .select('*')
    .eq('id', triggerId)
    .maybeSingle();

  if (error) {
    throw new WorkspaceConfigError(
      'trigger_load_failed',
      `Lecture signal_triggers impossible (${triggerId}): ${error.message}`,
    );
  }
  if (!data) {
    throw new WorkspaceConfigError(
      'trigger_not_found',
      `Trigger ${triggerId} introuvable — le signal doit être rattaché à un déclencheur existant`,
    );
  }

  const trigger = mapTriggerRow(data as Record<string, unknown>);
  triggerCache.set(triggerId, trigger);
  return trigger;
}

/** Vide les caches (utile si une edge function long-running recharge la config). */
export function clearWorkspaceConfigCache(): void {
  personasCache.clear();
  triggerCache.clear();
}

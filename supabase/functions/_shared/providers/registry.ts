/**
 * Provider resolver (Jay Reach 1.4.2).
 *
 * Resout le provider actif pour un workspace + categorie :
 * 1. Cherche dans workspace_providers (is_active = true)
 * 2. Charge le secret depuis workspace_provider_credentials (dechiffre via token-encryption), fallback env transitoire
 * 3. Fallback sur Deno.env.get(config.fallback_env) si pas de credential stocke
 * 4. Throw si rien ne resout (provider mal configure)
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type {
  ProviderCategory,
  ResolvedProvider,
  WorkspaceProviderRow,
  EmailValidator,
  EnrichmentProvider,
  LLMHandle,
  LLMProvider,
} from './types.ts';
import { decryptToken } from '../token-encryption.ts';
import { getProviderDescriptor } from './catalog.ts';
import { bouncerValidator } from './bouncer.ts';
import { reoonValidator } from './reoon.ts';
import { fullenrichEnricher } from './fullenrich.ts';
import { anthropicLLM } from './anthropic.ts';
import { openaiCompatibleLLM } from './openai-compatible.ts';

interface ResolveOptions {
  /** Forcer un provider_type specifique (utile si plusieurs providers actifs dans la meme categorie). */
  providerType?: string;
  /** Pour la categorie outreach, filtrer par channel (email|linkedin). */
  channel?: 'email' | 'linkedin';
}

/** Reconstruit un objet credential depuis un map champ→nom d'env. null si une variable manque. */
export function credentialFromEnv(map: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [field, envName] of Object.entries(map)) {
    const v = Deno.env.get(envName);
    if (!v || !v.trim()) return null;
    out[field] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Résout le credential (objet) d'un provider : BDD chiffrée d'abord, sinon fallback env (catalog + config.fallback_env). */
export async function resolveCredential(
  supabase: SupabaseClient, workspaceId: string, category: ProviderCategory, providerType: string,
): Promise<Record<string, string> | null> {
  const { data: row } = await supabase.from("workspace_providers")
    .select("id, config").eq("workspace_id", workspaceId)
    .eq("category", category).eq("provider_type", providerType).eq("is_active", true).maybeSingle();

  // 1) credential BDD
  if (row) {
    const secret = await loadCredentialSecret(supabase, (row as {id: string}).id);  // déchiffre
    if (secret) {
      try {
        return JSON.parse(secret);
      } catch {
        return { api_key: secret };
      }
    }  // back-compat string
  }

  // 2) fallback env : map du config.fallback_env sinon du catalogue
  const descriptor = getProviderDescriptor(providerType);
  const map = (row?.config?.fallback_env as Record<string,string> | undefined) ?? descriptor?.fallbackEnv ?? null;
  return map ? credentialFromEnv(map) : null;
}

/**
 * Résout le credential d'une ROW provider précise (par id), ACTIVE OU NON.
 * Usage : test de connexion depuis l'UI — on veut pouvoir tester un provider
 * fraîchement configuré AVANT de l'activer (resolveProvider filtre is_active).
 */
export async function resolveCredentialForProviderId(
  supabase: SupabaseClient,
  providerId: string,
): Promise<{ providerType: string; credentials: Record<string, string> | null } | null> {
  const { data: row } = await supabase
    .from('workspace_providers')
    .select('id, provider_type, config')
    .eq('id', providerId)
    .maybeSingle();
  if (!row) return null;

  const providerType = (row as { provider_type: string }).provider_type;
  const config = ((row as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>;

  const secret = await loadCredentialSecret(supabase, (row as { id: string }).id);
  if (secret) {
    try {
      return { providerType, credentials: JSON.parse(secret) };
    } catch {
      return { providerType, credentials: { api_key: secret } };
    }
  }

  const descriptor = getProviderDescriptor(providerType);
  const map = (config.fallback_env as Record<string, string> | undefined) ?? descriptor?.fallbackEnv ?? null;
  return { providerType, credentials: map ? credentialFromEnv(map) : null };
}

export async function resolveProvider<TConfig extends Record<string, unknown> = Record<string, unknown>>(
  supabase: SupabaseClient,
  workspaceId: string,
  category: ProviderCategory,
  options: ResolveOptions = {}
): Promise<ResolvedProvider<TConfig>> {
  let query = supabase
    .from('workspace_providers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('category', category)
    .eq('is_active', true);

  if (options.providerType) {
    query = query.eq('provider_type', options.providerType);
  }
  if (options.channel) {
    query = query.eq('channel', options.channel);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`resolveProvider: query failed for workspace ${workspaceId} / ${category}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`resolveProvider: no active ${category} provider configured for workspace ${workspaceId}`);
  }

  const row = data as WorkspaceProviderRow;
  const config = (row.config || {}) as Record<string, unknown>;

  // Mode demo : pas de cle API requise, le call site bascule sur des fake data.
  if (row.provider_type === 'demo') {
    return {
      workspaceId: row.workspace_id,
      providerType: 'demo',
      apiKey: DEMO_API_KEY,
      credentials: { api_key: DEMO_API_KEY },
      config: config as TConfig,
    };
  }

  // Résout via le nouveau resolveCredential (objet JSON chiffré ou fallback env map)
  const credentials = await resolveCredential(supabase, row.workspace_id, row.category as ProviderCategory, row.provider_type);

  if (!credentials) {
    throw new Error(
      `resolveProvider: ${row.provider_type} (${row.category}) actif mais aucune cle resolue (credential absent, fallback env manquant)`
    );
  }

  return {
    workspaceId: row.workspace_id,
    providerType: row.provider_type,
    apiKey: credentials.api_key ?? '',  // rétro-compat : apiKey = api_key du credential
    credentials,
    config: config as TConfig,
  };
}

/** Sentinel renvoye par resolveProvider quand provider_type='demo'. */
export const DEMO_API_KEY = '__DEMO_MODE__';

/** True si le resolver est en mode demo : le caller doit fake les resultats. */
export function isDemoMode(resolved: { apiKey: string; providerType: string }): boolean {
  return resolved.providerType === 'demo' || resolved.apiKey === DEMO_API_KEY;
}

/**
 * Choisit la cle effective : credential dechiffre prioritaire, sinon env fallback.
 * Fallback env conserve pendant la migration Vault→workspace, a retirer ensuite.
 */
export function resolveApiKey(opts: {
  credentialSecret: string | null;
  fallbackEnvName: string | null;
}): string | null {
  if (opts.credentialSecret && opts.credentialSecret.trim()) return opts.credentialSecret;
  if (opts.fallbackEnvName) {
    const fromEnv = Deno.env.get(opts.fallbackEnvName);
    if (fromEnv && fromEnv.trim()) return fromEnv;
  }
  return null;
}

/**
 * Charge le secret dechiffre depuis workspace_provider_credentials.
 * Renvoie null si pas de credential stocke (le caller tente alors le fallback env).
 */
async function loadCredentialSecret(
  supabase: SupabaseClient,
  providerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('workspace_provider_credentials')
    .select('encrypted_key')
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) {
    console.warn(`[providers] lecture credential echouee pour ${providerId}: ${error.message}`);
    return null;
  }
  const row = data as { encrypted_key?: string } | null;
  if (!row?.encrypted_key) return null;
  try {
    return await decryptToken(row.encrypted_key);
  } catch (err) {
    console.error(`[providers] dechiffrement credential echoue pour ${providerId}:`, err);
    return null;
  }
}

/**
 * Helper qui resout pour le workspace ADMIN par defaut (utile pour les
 * crons qui ne sont pas attaches a un user particulier). Resolve le 1er
 * workspace ayant un provider actif de cette categorie.
 *
 * V1 mono-tenant : equivaut au workspace Jay. V2 multi-tenant : iterer
 * sur tous les workspaces eligibles cote caller.
 */
export async function resolveProviderForDefaultWorkspace<TConfig extends Record<string, unknown> = Record<string, unknown>>(
  supabase: SupabaseClient,
  category: ProviderCategory,
  options: ResolveOptions = {}
): Promise<ResolvedProvider<TConfig>> {
  let query = supabase
    .from('workspace_providers')
    .select('workspace_id')
    .eq('category', category)
    .eq('is_active', true)
    .limit(1);

  if (options.providerType) query = query.eq('provider_type', options.providerType);
  if (options.channel) query = query.eq('channel', options.channel);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`resolveProviderForDefaultWorkspace query failed: ${error.message}`);
  if (!data) throw new Error(`No active ${category} provider in any workspace`);

  return resolveProvider<TConfig>(supabase, data.workspace_id as string, category, options);
}

// ─── Factory provider_type → adapter + résolveurs par catégorie ──────────────
// Généralise le pattern outreach (resolveOutreachProvider) aux catégories
// validator + enricher. Le caller appelle l'interface de l'adapter, jamais
// le client brut. Le 'demo' provider n'a pas d'adapter → provider=null, le
// caller bascule sur des fake data (isDemoMode).

const VALIDATORS: Record<string, EmailValidator> = {
  bouncer: bouncerValidator,
  reoon: reoonValidator,
};
const ENRICHERS: Record<string, EnrichmentProvider> = {
  fullenrich: fullenrichEnricher,
};
const LLMS: Record<string, LLMProvider> = {
  anthropic: anthropicLLM,
  openai_compatible: openaiCompatibleLLM,
};

export function validatorAdapterFor(providerType: string): EmailValidator | null {
  return VALIDATORS[providerType] ?? null;
}
export function enricherAdapterFor(providerType: string): EnrichmentProvider | null {
  return ENRICHERS[providerType] ?? null;
}
export function llmAdapterFor(providerType: string): LLMProvider | null {
  return LLMS[providerType] ?? null;
}

/** Résout le validateur ACTIF d'un workspace donné (provider=null en mode demo). */
export async function resolveValidator(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ provider: EmailValidator | null; context: ResolvedProvider }> {
  const context = await resolveProvider(supabase, workspaceId, 'validator', {});
  if (context.providerType === 'demo') return { provider: null, context };
  const provider = validatorAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveValidator: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

/** Résout le validateur ACTIF du workspace par défaut (crons sans workspace attaché). */
export async function resolveValidatorForDefaultWorkspace(
  supabase: SupabaseClient,
): Promise<{ provider: EmailValidator | null; context: ResolvedProvider }> {
  const context = await resolveProviderForDefaultWorkspace(supabase, 'validator', {});
  if (context.providerType === 'demo') return { provider: null, context };
  const provider = validatorAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveValidator: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

/**
 * Résout le LLM ACTIF d'un workspace donné (ou/ou : le provider llm actif,
 * quel que soit son type — les call-sites ne forcent plus 'anthropic').
 */
export async function resolveLLM(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<LLMHandle> {
  const context = await resolveProvider(supabase, workspaceId, 'llm', {});
  const provider = llmAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveLLM: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

/** Résout le LLM ACTIF du workspace par défaut (crons sans workspace attaché). */
export async function resolveLLMForDefaultWorkspace(
  supabase: SupabaseClient,
): Promise<LLMHandle> {
  const context = await resolveProviderForDefaultWorkspace(supabase, 'llm', {});
  const provider = llmAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveLLM: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

/** Résout l'enricher ACTIF d'un workspace donné. */
export async function resolveEnricher(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ provider: EnrichmentProvider; context: ResolvedProvider }> {
  const context = await resolveProvider(supabase, workspaceId, 'enricher', {});
  const provider = enricherAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveEnricher: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

/** Résout l'enricher ACTIF du workspace par défaut. */
export async function resolveEnricherForDefaultWorkspace(
  supabase: SupabaseClient,
): Promise<{ provider: EnrichmentProvider; context: ResolvedProvider }> {
  const context = await resolveProviderForDefaultWorkspace(supabase, 'enricher', {});
  const provider = enricherAdapterFor(context.providerType);
  if (!provider) throw new Error(`resolveEnricher: adapter inconnu '${context.providerType}'`);
  return { provider, context };
}

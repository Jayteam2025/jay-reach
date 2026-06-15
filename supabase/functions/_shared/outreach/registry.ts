// Registry des outreach providers. Pour ajouter un provider :
// 1. Implementer OutreachProvider dans son propre fichier.
// 2. L'enregistrer ici via PROVIDERS.
// 3. Ajouter le type dans le CHECK constraint de workspace_providers (CATEGORY='outreach').
//
// Jay Reach 1.5.2 : lit workspace_providers (table generique 1.4.2) au lieu de
// workspace_outreach_providers (table legacy 1.4.1, conservee pour backward compat).
// La cle API est resolue via resolveProvider (Vault > env fallback) plutot que
// d'etre lue depuis Deno.env dans _shared/smartlead.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OutreachProvider, OutreachProviderConfig } from "./types.ts";
import { smartleadProvider } from "./smartlead-provider.ts";
import { resolveProvider } from "../providers/registry.ts";

const PROVIDERS: Record<string, OutreachProvider> = {
  smartlead: smartleadProvider,
  // microsoft_graph: microsoftGraphProvider, // TODO Phase 1.4 V2
  // resend: resendProvider,                  // TODO Phase 1.4 V2
};

export interface ResolvedProvider {
  provider: OutreachProvider;
  context: OutreachProviderConfig;
}

/**
 * Resout le provider actif pour (workspace, channel) depuis workspace_providers.
 * Retourne null si aucun provider configure (l'appelant doit decider du
 * comportement : 412 / fallback / etc.).
 *
 * En interne :
 * 1. SELECT workspace_providers WHERE category='outreach', workspace_id, channel, is_active=true
 * 2. resolveProvider() pour charger l'apiKey (Vault > env fallback)
 * 3. Retourne provider + context { apiKey, config, workspace_id }
 */
export async function resolveOutreachProvider(
  supabase: SupabaseClient,
  workspaceId: string,
  channel: string,
): Promise<ResolvedProvider | null> {
  const { data: row } = await supabase
    .from("workspace_providers")
    .select("provider_type, config")
    .eq("workspace_id", workspaceId)
    .eq("category", "outreach")
    .eq("channel", channel)
    .eq("is_active", true)
    .maybeSingle();

  if (!row) return null;

  const provider = PROVIDERS[row.provider_type as string];
  if (!provider) {
    console.warn(`[outreach-registry] provider ${row.provider_type} actif en DB mais pas enregistre dans le code`);
    return null;
  }

  // Resout l'apiKey via le resolver generique (Vault > env fallback).
  // Si demo, renvoie le sentinel DEMO_API_KEY (le caller verifie isDemoMode).
  let resolved;
  try {
    resolved = await resolveProvider(supabase, workspaceId, "outreach", {
      providerType: row.provider_type as string,
      channel: channel as "email" | "linkedin",
    });
  } catch (err) {
    console.error(`[outreach-registry] failed to resolve apiKey for ${row.provider_type}:`, err);
    return null;
  }

  return {
    provider,
    context: {
      workspace_id: workspaceId,
      config: (row.config as Record<string, unknown>) ?? {},
      apiKey: resolved.apiKey,
    },
  };
}

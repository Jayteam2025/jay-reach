/**
 * Helpers pour brancher la feature webhook FullEnrich dans les callers.
 *
 * Le pattern :
 *   1. submitBulkEnrichment doit recevoir webhook_url en option
 *   2. pollBulkEnrichment peut recevoir un checkWebhook callback qui lit
 *      pending_fullenrich_bulks au lieu de hit FullEnrich GET
 *
 * Cf migration 20260428140000_pending_fullenrich_bulks.sql et edge function
 * fullenrich-webhook pour le receiver cote DB.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { FullEnrichJobResult } from "./fullenrich.ts";

/**
 * Construit l'URL webhook a passer a FullEnrich. Retourne null si la config
 * webhook n'est pas en place (token manquant) — dans ce cas, le caller
 * doit fallback sur le polling classique (comportement avant la PR webhook).
 */
export function buildFullenrichWebhookUrl(): string | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const token = Deno.env.get("FULLENRICH_WEBHOOK_TOKEN");
  if (!supabaseUrl || !token) return null;
  return `${supabaseUrl}/functions/v1/fullenrich-webhook?token=${encodeURIComponent(token)}`;
}

/**
 * Construit le callback checkWebhook a passer a pollBulkEnrichment. Lit
 * pending_fullenrich_bulks pour l'enrichmentId donne. Retourne null si pas
 * encore recu, le payload complet sinon.
 */
export function buildCheckWebhook(
  supabase: SupabaseClient,
  enrichmentId: string,
): () => Promise<FullEnrichJobResult | null> {
  return async () => {
    const { data, error } = await supabase
      .from("pending_fullenrich_bulks")
      .select("webhook_payload")
      .eq("enrichment_id", enrichmentId)
      .maybeSingle();

    if (error) {
      console.warn(
        `[fullenrich-webhook-helpers] check failed for ${enrichmentId}: ${error.message}`,
      );
      return null;
    }
    if (!data?.webhook_payload) return null;
    return data.webhook_payload as FullEnrichJobResult;
  };
}

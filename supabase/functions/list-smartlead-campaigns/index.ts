import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveCredentialForProviderId } from "../_shared/providers/registry.ts";
import { listCampaigns } from "../_shared/smartlead.ts";

/**
 * list-smartlead-campaigns
 *
 * Liste les campagnes du compte Smartlead du workspace, pour alimenter le
 * dropdown de mapping persona -> campagne (onglet Campagnes).
 *
 * Body (optionnel) : { workspace_id?: string }
 *   - absent : on prend le 1er workspace de l'user.
 * Auth : membre du workspace.
 *
 * Retourne : { ok: true, campaigns: [{ id, name, status }] }
 *            { ok: false, error: string }   (200, pour affichage UI)
 */

interface Payload {
  workspace_id?: string;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, cors);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { userId, error: authError } = await extractUserId(supabase, req);
  if (authError || !userId) {
    return json(401, { error: "Unauthorized" }, cors);
  }

  let body: Payload = {};
  try {
    body = await req.json();
  } catch {
    // body optionnel
  }

  // Resout le workspace : fourni (verifie membership) ou 1er du user.
  let workspaceId = body.workspace_id?.trim();
  if (workspaceId) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return json(403, { error: "Acces refuse a ce workspace" }, cors);
  } else {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!member) return json(404, { error: "Aucun workspace" }, cors);
    workspaceId = (member as { workspace_id: string }).workspace_id;
  }

  // Provider Smartlead (outreach/email) actif du workspace.
  const { data: provider } = await supabase
    .from("workspace_providers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("category", "outreach")
    .eq("provider_type", "smartlead")
    .eq("channel", "email")
    .eq("is_active", true)
    .maybeSingle();
  if (!provider) {
    return json(200, {
      ok: false,
      error: "Aucun provider Smartlead actif. Configure ta cle dans l'onglet Providers.",
    }, cors);
  }

  const resolved = await resolveCredentialForProviderId(supabase, (provider as { id: string }).id);
  const apiKey = resolved?.credentials?.api_key;
  if (!apiKey) {
    return json(200, {
      ok: false,
      error: "Cle Smartlead absente. Renseigne-la dans l'onglet Providers.",
    }, cors);
  }

  try {
    const campaigns = await listCampaigns(apiKey);
    return json(200, { ok: true, campaigns }, cors);
  } catch (_err) {
    // Ne jamais renvoyer l'erreur brute : l'URL Smartlead contient ?api_key=...
    console.error("[list-smartlead-campaigns] echec (detail masque pour ne pas fuiter la cle)");
    return json(200, {
      ok: false,
      error: "Echec de la recuperation des campagnes Smartlead.",
    }, cors);
  }
});

function json(status: number, obj: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

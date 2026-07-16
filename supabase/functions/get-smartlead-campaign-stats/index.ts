import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decryptTokenSafe } from "../_shared/token-encryption.ts";
import { getCampaignAnalytics, getCampaignSequences } from "../_shared/smartlead.ts";

/**
 * get-smartlead-campaign-stats
 *
 * Renvoie les analytics (envois / ouvertures / réponses) et la séquence d'une
 * campagne Smartlead, pour alimenter l'écran Campagnes en données réelles.
 *
 * Body : { campaign_id: string | number, workspace_id?: string }
 * Auth : membre du workspace. La clé API Smartlead est résolue depuis
 *        workspace_provider_credentials (déchiffrement AES-GCM).
 *
 * Retour : { ok: true, analytics, sequence } | { ok: false, error } (200, pour l'UI).
 * Ne jamais renvoyer l'erreur brute : l'URL Smartlead contient ?api_key=...
 */
interface Payload {
  workspace_id?: string;
  campaign_id?: string | number;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" }, cors);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  const { data: userData } = await anon.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json(401, { ok: false, error: "Unauthorized" }, cors);

  let body: Payload = {};
  try {
    body = await req.json();
  } catch {
    // body optionnel
  }

  // Resout le workspace (fourni + membership vérifiée, sinon 1er du user)
  let workspaceId = body.workspace_id?.trim();
  if (workspaceId) {
    const { data: m } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!m) return json(403, { ok: false, error: "Acces refuse a ce workspace" }, cors);
  } else {
    const { data: m } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!m) return json(404, { ok: false, error: "Aucun workspace" }, cors);
    workspaceId = (m as { workspace_id: string }).workspace_id;
  }

  const campaignId = body.campaign_id;
  if (campaignId === undefined || campaignId === null || `${campaignId}`.trim() === "") {
    return json(200, { ok: false, error: "campaign_id manquant" }, cors);
  }

  // Provider Smartlead actif
  const { data: provider } = await admin
    .from("workspace_providers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("category", "outreach")
    .eq("provider_type", "smartlead")
    .eq("channel", "email")
    .eq("is_active", true)
    .maybeSingle();
  if (!provider) {
    return json(200, { ok: false, error: "Aucun provider Smartlead actif. Configure ta cle dans l'onglet Providers." }, cors);
  }

  // Clé API (déchiffrée)
  const { data: cred } = await admin
    .from("workspace_provider_credentials")
    .select("encrypted_key")
    .eq("provider_id", (provider as { id: string }).id)
    .maybeSingle();
  const encrypted = (cred as { encrypted_key?: string } | null)?.encrypted_key;
  if (!encrypted) {
    return json(200, { ok: false, error: "Cle Smartlead absente. Renseigne-la dans l'onglet Providers." }, cors);
  }

  let apiKey = "";
  try {
    const secret = await decryptTokenSafe(encrypted, "smartlead");
    try {
      apiKey = (JSON.parse(secret) as { api_key?: string }).api_key ?? secret;
    } catch {
      apiKey = secret;
    }
  } catch {
    return json(200, { ok: false, error: "Cle Smartlead illisible." }, cors);
  }
  if (!apiKey) return json(200, { ok: false, error: "Cle Smartlead vide." }, cors);

  // Analytics + séquence (best effort, indépendants)
  let analytics: unknown = null;
  let sequence: unknown[] = [];
  try {
    analytics = await getCampaignAnalytics(campaignId, apiKey);
  } catch {
    console.error("[get-smartlead-campaign-stats] analytics indisponibles (detail masque)");
  }
  try {
    sequence = await getCampaignSequences(campaignId, apiKey);
  } catch {
    console.error("[get-smartlead-campaign-stats] sequence indisponible (detail masque)");
  }

  if (!analytics && sequence.length === 0) {
    return json(200, { ok: false, error: "Impossible de recuperer les stats Smartlead." }, cors);
  }
  return json(200, { ok: true, analytics, sequence }, cors);
});

function json(status: number, obj: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

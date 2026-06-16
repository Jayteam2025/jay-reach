import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { encryptToken } from "../_shared/token-encryption.ts";

/**
 * set-provider-credential (Jay Reach 1.4.3)
 *
 * Sauvegarde la cle API d'un provider chiffree (encryptToken) dans
 * workspace_provider_credentials, et met a jour les metadonnees d'affichage
 * (credential_last4, credential_set_at) sur workspace_providers.
 * La cle ne traine ni en clair en DB ni dans les logs.
 *
 * Auth : admin du workspace (verifie via workspace_members.role).
 *
 * Body : { provider_id: string, api_key: string }
 *   provider_id : UUID de la row workspace_providers
 *   api_key : valeur a stocker chiffree (string non vide)
 */

interface Payload {
  provider_id?: string;
  credentials?: Record<string, string>;
  api_key?: string;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { userId, error: authError } = await extractUserId(supabase, req);
  if (authError || !userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const providerId = body.provider_id?.trim();
  // Rétro-compat : accepte credentials (objet) OU api_key (string)
  const creds = body.credentials ?? (body.api_key ? { api_key: body.api_key } : null);
  if (!providerId || !creds || Object.values(creds).some((v) => !v || !v.trim())) {
    return new Response(JSON.stringify({ error: "provider_id et credentials requis" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: provider, error: fetchErr } = await supabase
    .from("workspace_providers")
    .select("id, workspace_id, provider_type, category, config")
    .eq("id", providerId)
    .single();
  if (fetchErr || !provider) {
    return new Response(JSON.stringify({ error: "Provider introuvable" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", provider.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return new Response(JSON.stringify({ error: "Admin requis sur ce workspace" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Chiffre + upsert dans workspace_provider_credentials (1 ligne par provider).
  // ON CONFLICT corrige le 500 historique (double-clic -> create sur nom deja pris).
  let encryptedKey: string;
  try {
    encryptedKey = await encryptToken(JSON.stringify(creds));
  } catch (err) {
    console.error("[set-provider-credential] chiffrement echoue:", err);
    return new Response(JSON.stringify({ error: "Chiffrement indisponible (TOKEN_ENCRYPTION_KEY manquante ?)" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // last4 : sur le dernier champ secret du schéma, sinon la 1re valeur
  const last4 = Object.values(creds).at(-1)!.slice(-4);

  // created_at pose par le default de la table a l'insert.
  const { error: upsertErr } = await supabase
    .from("workspace_provider_credentials")
    .upsert({
      provider_id: providerId,
      workspace_id: provider.workspace_id,
      encrypted_key: encryptedKey,
      last4,
      updated_at: new Date().toISOString(),
      set_by: userId,
    }, { onConflict: "provider_id" });
  if (upsertErr) {
    console.error("[set-provider-credential] upsert credential echoue:", upsertErr);
    return new Response(JSON.stringify({ error: `DB upsert failed: ${upsertErr.message}` }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Purge les anciens pointeurs (legacy Vault + env) du config + maj metadonnees d'affichage.
  // N'est PLUS purger fallback_env (le fallback doit rester comme filet self-host).
  const nextConfig = { ...(provider.config || {}) } as Record<string, unknown>;
  delete nextConfig.api_key_vault_secret;
  delete nextConfig.api_key_inline;

  const { error: updateErr } = await supabase
    .from("workspace_providers")
    .update({
      config: nextConfig,
      credential_last4: last4,
      credential_set_at: new Date().toISOString(),
    })
    .eq("id", providerId);
  if (updateErr) {
    return new Response(JSON.stringify({ error: `DB update failed: ${updateErr.message}` }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, last4 }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});

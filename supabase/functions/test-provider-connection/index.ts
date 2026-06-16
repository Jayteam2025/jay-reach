import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveCredentialForProviderId } from "../_shared/providers/registry.ts";

/**
 * test-provider-connection (Jay Reach 1.4.3)
 *
 * Ping l'API du provider configure pour valider la cle.
 *
 * Body : { provider_id: string }
 * Auth : membre du workspace (verifie via RLS sur workspace_providers).
 *
 * Retourne :
 *   { ok: true, provider_type, latency_ms, info?: { balance, ... } }
 *   { ok: false, error: string }
 */

interface Payload {
  provider_id?: string;
}

interface TestResult {
  ok: boolean;
  latency_ms: number;
  info?: Record<string, unknown>;
  error?: string;
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
  if (!providerId) {
    return new Response(JSON.stringify({ error: "provider_id requis" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: providerRow, error: fetchErr } = await supabase
    .from("workspace_providers")
    .select("id, workspace_id, provider_type, category")
    .eq("id", providerId)
    .single();
  if (fetchErr || !providerRow) {
    return new Response(JSON.stringify({ error: "Provider introuvable" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", providerRow.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return new Response(JSON.stringify({ error: "Acces refuse a ce workspace" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Résout le credential de CETTE row, active ou non : on doit pouvoir tester
  // un provider fraîchement configuré avant de l'activer (resolveProvider
  // filtre is_active=true → "no active llm provider" sur un provider inactif).
  const resolved = await resolveCredentialForProviderId(supabase, providerRow.id);
  if (!resolved || !resolved.credentials) {
    return new Response(
      JSON.stringify({ ok: false, error: "Aucun credential configuré pour ce provider (clé absente et pas de fallback env)" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const result = await pingProvider(resolved.providerType, resolved.credentials);

  const detail = result.ok
    ? `OK ${result.latency_ms}ms`
    : (result.error ?? "Échec").slice(0, 200);
  const { error: persistErr } = await supabase
    .from("workspace_providers")
    .update({
      last_test_status: result.ok ? "ok" : "error",
      last_test_at: new Date().toISOString(),
      last_test_detail: detail,
    })
    .eq("id", providerRow.id);
  if (persistErr) {
    console.warn("[test-provider-connection] persist statut echoue:", persistErr.message);
  }

  return new Response(
    JSON.stringify({ ...result, provider_type: resolved.providerType }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );
});

async function pingProvider(providerType: string, credentials: Record<string, string>): Promise<TestResult> {
  const start = Date.now();
  const apiKey = credentials.api_key ?? "";
  try {
    switch (providerType) {
      case "bouncer":
        return await pingBouncer(apiKey, start);
      case "reoon":
        return await pingReoon(apiKey, start);
      case "fullenrich":
        return await pingFullEnrich(apiKey, start);
      case "smartlead":
        return await pingSmartlead(apiKey, start);
      case "anthropic":
        return await pingAnthropic(apiKey, start);
      case "openai_compatible":
        return await pingOpenAICompatible(credentials, start);
      case "adzuna":
        return await pingAdzuna(credentials, start);
      case "france_travail":
        return await pingFranceTravail(credentials, start);
      default:
        return { ok: false, latency_ms: 0, error: `provider_type "${providerType}" non testable` };
    }
  } catch (err) {
    // Ne JAMAIS renvoyer err.message : un echec fetch Deno inclut l'URL complete,
    // qui pour Smartlead contient ?api_key=... -> fuite de cle (renvoyee au client
    // ET persistee dans last_test_detail, affichee dans l'UI). On logue uniquement
    // le type de provider, jamais l'erreur brute, et on renvoie un message generique.
    console.error(`[test-provider-connection] ping ${providerType} a echoue (detail masque pour ne pas fuiter la cle)`);
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: "Echec du test de connexion (voir logs serveur)",
    };
  }
}

async function pingBouncer(apiKey: string, start: number): Promise<TestResult> {
  // Endpoint officiel : GET /v1.1/credits (cf docs.usebouncer.com/api-reference/credits/credits).
  // /v1.1/account/credits n'existe pas -> 403 avec une cle valide (auth-first gateway).
  const res = await fetch("https://api.usebouncer.com/v1.1/credits", {
    headers: { "x-api-key": apiKey, "Accept": "application/json" },
  });
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null);
  return { ok: true, latency_ms: latency, info: { credits: body } };
}

async function pingFullEnrich(apiKey: string, start: number): Promise<TestResult> {
  const res = await fetch("https://app.fullenrich.com/api/v2/account/credits", {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null);
  return { ok: true, latency_ms: latency, info: { balance: body } };
}

async function pingSmartlead(apiKey: string, start: number): Promise<TestResult> {
  // Smartlead utilise ?api_key=... en query param.
  const res = await fetch(
    `https://server.smartlead.ai/api/v1/campaigns?api_key=${encodeURIComponent(apiKey)}`,
    { headers: { "Accept": "application/json" } }
  );
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null);
  const count = Array.isArray(body) ? body.length : null;
  return { ok: true, latency_ms: latency, info: { campaigns_count: count } };
}

async function pingReoon(apiKey: string, start: number): Promise<TestResult> {
  // check-account-balance : valide la cle SANS consommer de credit de verification
  // (contrairement a /verify, meme en mode quick). Renvoie aussi les credits restants.
  const res = await fetch(
    `https://emailverifier.reoon.com/api/v1/check-account-balance/?key=${encodeURIComponent(apiKey)}`,
    { headers: { "Accept": "application/json" } },
  );
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null) as {
    status?: string; api_status?: string;
    remaining_daily_credits?: number; remaining_instant_credits?: number;
  } | null;
  if (body?.status === "success" || body?.api_status === "active") {
    return {
      ok: true,
      latency_ms: latency,
      info: { daily: body.remaining_daily_credits, instant: body.remaining_instant_credits },
    };
  }
  return { ok: false, latency_ms: latency, error: "Clé Reoon invalide" };
}

async function pingAnthropic(apiKey: string, start: number): Promise<TestResult> {
  // GET /v1/models : valide la cle sans consommer de tokens.
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  return { ok: true, latency_ms: latency };
}

async function pingOpenAICompatible(creds: Record<string, string>, start: number): Promise<TestResult> {
  const baseUrl = (creds.base_url ?? "").replace(/\/+$/, "");
  if (!creds.api_key || !baseUrl) return { ok: false, latency_ms: 0, error: "api_key / base_url manquants" };
  if (!creds.model_fast || !creds.model_smart) {
    return { ok: false, latency_ms: 0, error: "model_fast / model_smart manquants" };
  }
  // GET /models : standard OpenAI-compatible (OpenAI, Mistral, Groq, Ollama),
  // valide la cle + l'URL sans consommer de tokens.
  const res = await fetch(`${baseUrl}/models`, {
    headers: { "Authorization": `Bearer ${creds.api_key}` },
  });
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  return { ok: true, latency_ms: latency };
}

async function pingAdzuna(creds: Record<string, string>, start: number): Promise<TestResult> {
  const appId = creds.app_id, appKey = creds.app_key;
  if (!appId || !appKey) return { ok: false, latency_ms: 0, error: "app_id / app_key manquants" };
  const res = await fetch(
    `https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=1`,
    { headers: { "Accept": "application/json" } },
  );
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null) as { count?: number } | null;
  return { ok: true, latency_ms: latency, info: { count: body?.count } };
}

async function pingFranceTravail(creds: Record<string, string>, start: number): Promise<TestResult> {
  const clientId = creds.client_id, clientSecret = creds.client_secret;
  if (!clientId || !clientSecret) return { ok: false, latency_ms: 0, error: "client_id / client_secret manquants" };
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("scope", "api_offresdemploiv2 o2dsoffre");
  const res = await fetch(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() },
  );
  const latency = Date.now() - start;
  if (!res.ok) {
    return { ok: false, latency_ms: latency, error: `HTTP ${res.status} ${res.statusText}` };
  }
  const body = await res.json().catch(() => null) as { access_token?: string } | null;
  return body?.access_token
    ? { ok: true, latency_ms: latency }
    : { ok: false, latency_ms: latency, error: "Pas de token" };
}

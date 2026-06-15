import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseWebhookPayload, downloadResults, BouncerError, BouncerWebhookRequestSchema } from "../_shared/bouncer.ts";
import { resolveProviderForDefaultWorkspace } from "../_shared/providers/registry.ts";
import { validateOrRespond } from "../_shared/validation.ts";

/**
 * bouncer-webhook
 *
 * Receveur public appele par Bouncer quand un batch verification finit.
 * Auth via query token `?token=$BOUNCER_WEBHOOK_TOKEN`.
 *
 * Pour chaque resultat :
 *  - UPDATE prospect_profiles deliverability_status / reason / checked_at / provider
 *  - INSERT pattern_audit_events event_type='bouncer_verdict'
 *  - UPDATE bouncer_jobs status='completed'
 *
 * Schéma de validation (BouncerWebhookRequestSchema) exporté depuis _shared/bouncer.ts.
 */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedToken = Deno.env.get("BOUNCER_WEBHOOK_TOKEN");
  if (!expectedToken) {
    console.error("[bouncer-webhook] BOUNCER_WEBHOOK_TOKEN not configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== expectedToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let raw;
  try {
    raw = await req.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[bouncer-webhook] parse failed: ${message}`);
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const _validation = validateOrRespond(BouncerWebhookRequestSchema, raw, { "Content-Type": "application/json" }, "strict", { functionName: "bouncer-webhook" });
  if (_validation.response) return _validation.response;

  let payload;
  try {
    payload = parseWebhookPayload(_validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[bouncer-webhook] parseWebhookPayload failed: ${message}`);
    return new Response(JSON.stringify({ error: "Invalid payload structure" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: job } = await supabase
    .from("bouncer_jobs")
    .select("profile_ids, status")
    .eq("job_id", payload.id)
    .maybeSingle();

  if (!job) {
    console.warn(`[bouncer-webhook] unknown job_id=${payload.id}`);
    return new Response(JSON.stringify({ error: "Unknown job" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  if (job.status === "completed") {
    console.log(`[bouncer-webhook] job ${payload.id} already completed (idempotent)`);
    return new Response(JSON.stringify({ ok: true, already: true }), { status: 200 });
  }

  await supabase.from("bouncer_jobs").update({
    status: "completed",
    received_at: new Date().toISOString(),
    webhook_payload: payload as unknown as Record<string, unknown>,
  }).eq("job_id", payload.id);

  // Si le webhook n'inclut pas les results inline, on les telecharge.
  let results = payload.results;
  if (!results || results.length === 0) {
    let apiKey: string;
    try {
      const provider = await resolveProviderForDefaultWorkspace(
        supabase,
        "validator",
        { providerType: "bouncer" }
      );
      apiKey = provider.apiKey;
    } catch (err) {
      console.error("[bouncer-webhook] Bouncer provider not configured:", err);
      return new Response(JSON.stringify({ ok: true, results: 0, warn: "no_api_key" }), { status: 200 });
    }
    try {
      results = await downloadResults(payload.id, apiKey);
      console.log(`[bouncer-webhook] downloaded ${results.length} results for batchId=${payload.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bouncer-webhook] download failed: ${message}`);
      return new Response(JSON.stringify({ error: message }), { status: 502 });
    }
  }

  if (results.length === 0) {
    return new Response(JSON.stringify({ ok: true, results: 0 }), { status: 200 });
  }

  const now = new Date().toISOString();
  for (const result of results) {
    const { data: profile } = await supabase
      .from("prospect_profiles")
      .select("id, email, email_source")
      .ilike("email", result.email)
      .limit(1)
      .maybeSingle();
    if (!profile) continue;

    await supabase.from("prospect_profiles").update({
      // Colonnes génériques de délivrabilité (Bouncer = verdict déjà normalisé).
      // Les anciennes colonnes bouncer_* ont été supprimées (Task 10 OSS).
      deliverability_status: result.status,
      deliverability_reason: result.reason ?? null,
      deliverability_checked_at: now,
      deliverability_provider: "bouncer",
    }).eq("id", profile.id);

    const domain = result.email.split("@")[1]?.toLowerCase() ?? "";
    await supabase.from("pattern_audit_events").insert({
      prospect_id: profile.id,
      email: result.email,
      domain,
      email_source: profile.email_source ?? "unknown",
      event_type: "bouncer_verdict",
      event_value: result.status,
    });
  }

  return new Response(JSON.stringify({ ok: true, results: results.length }), { status: 200 });
});

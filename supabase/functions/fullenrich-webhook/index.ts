import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateOrRespond } from "../_shared/validation.ts";
import { FullenrichWebhookRequestSchema } from "../_shared/fullenrich.ts";

/**
 * fullenrich-webhook
 *
 * Receveur public appele par FullEnrich quand un bulk enrichment finit.
 * Pas d'auth FullEnrich (ils ne signent pas), donc on protege via un token
 * partage en query string : `?token=$FULLENRICH_WEBHOOK_TOKEN`.
 *
 * URL configuree dans submitBulkEnrichment :
 *   https://<your-project-ref>.supabase.co/functions/v1/fullenrich-webhook?token=XXX
 *
 * FullEnrich POST le meme payload que GET /contact/enrich/bulk/{id} :
 *   { id, name, status, cost, data: [...] }
 *
 * On upsert dans pending_fullenrich_bulks (cle = id de l'enrichment job).
 * Le poll consummateur (pollBulkEnrichment) lit cette table avant de faire
 * un GET HTTP, ce qui evite le polling qui mange le rate limit (60/min).
 *
 * Idempotent : un meme call recu plusieurs fois ne pose pas de probleme,
 * on ecrase le payload (qui sera identique de toute facon).
 */

// Schéma (FullenrichWebhookRequestSchema) exporté depuis _shared/fullenrich.ts.
// Bug #410 : l'ancien schéma typait `cost: z.number()` alors que FullEnrich envoie
// `cost: { credits }` (objet) -> rejet 400. Idem bouncer-webhook (batchId vs id).

Deno.serve(async (req: Request) => {
  // FullEnrich envoie en POST. Refuse les autres methodes.
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ─── Auth via token URL ────────────────────────────────────────────────────
  const expectedToken = Deno.env.get("FULLENRICH_WEBHOOK_TOKEN");
  if (!expectedToken) {
    console.error("[fullenrich-webhook] FULLENRICH_WEBHOOK_TOKEN not configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== expectedToken) {
    // Pas de log du token recu (eviter de leaker en cas de scan)
    console.warn(`[fullenrich-webhook] auth failed (origin=${req.headers.get("origin") || "?"})`);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ─── Parse body ────────────────────────────────────────────────────────────
  let payload: { id?: string; status?: string; data?: unknown };
  try {
    payload = await req.json();
  } catch (err) {
    console.warn(`[fullenrich-webhook] invalid JSON: ${err instanceof Error ? err.message : err}`);
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const _validation = validateOrRespond(FullenrichWebhookRequestSchema, payload, { "Content-Type": "application/json" }, "strict", { functionName: "fullenrich-webhook" });
  if (_validation.response) return _validation.response;

  const enrichmentId = _validation.data.id;
  if (!enrichmentId || typeof enrichmentId !== "string") {
    console.warn(`[fullenrich-webhook] missing id in payload`);
    return new Response(JSON.stringify({ error: "Missing id in payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  payload = _validation.data;

  // ─── Upsert dans pending_fullenrich_bulks ──────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { error } = await supabase
    .from("pending_fullenrich_bulks")
    .upsert({
      enrichment_id: enrichmentId,
      webhook_payload: payload,
      received_at: new Date().toISOString(),
    }, { onConflict: "enrichment_id" });

  if (error) {
    console.error(`[fullenrich-webhook] upsert failed for ${enrichmentId}: ${error.message}`);
    // 5xx pour que FullEnrich retry (jusqu'a 5 fois selon leur doc)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(
    `[fullenrich-webhook] received id=${enrichmentId} status=${payload.status || "?"} data_count=${Array.isArray(payload.data) ? payload.data.length : 0}`,
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

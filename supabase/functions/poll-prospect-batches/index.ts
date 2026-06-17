import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * poll-prospect-batches
 *
 * Appele toutes les 10 min par pg_cron.
 * Pour chaque batch "in_progress" dans prospect_batches, appelle le mode
 * check-batch de la fonction associee (score-prospect-signals ou
 * generate-prospect-messages-bulk) qui finalise les resultats cote DB quand
 * le batch Anthropic est termine.
 */

interface BatchRow {
  id: string;
  batch_id: string;
  batch_type: "scoring" | "prospect_messages";
}

// Schéma de validation Zod pour poll-prospect-batches
const PollProspectBatchesRequestSchema = z.object({
  only_batch_row_id: z.string().uuid().optional(),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isAuthorized = authHeader === `Bearer ${cronSecret}` || authHeader === `Bearer ${serviceRoleKey}`;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Optionnel : ne check qu'un seul batch (appele par poll-batch-reactive
  // apres submission pour recuperer les resultats rapidement).
  const body = await req.json().catch(() => ({})) as { only_batch_row_id?: string };
  const _validation = validateOrRespond(PollProspectBatchesRequestSchema, body, corsHeaders, "strict", { functionName: "poll-prospect-batches" });
  if (_validation.response) return _validation.response;

  const onlyBatchRowId = _validation.data.only_batch_row_id;

  let query = supabase
    .from("prospect_batches")
    .select("id, batch_id, batch_type")
    .eq("status", "in_progress")
    .order("submitted_at", { ascending: true });

  if (onlyBatchRowId) {
    query = query.eq("id", onlyBatchRowId);
  }

  const { data: pending, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("[poll-prospect-batches] fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ pending: 0, finalized: 0 }), {
      status: 200,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  // Admin user_id pour les appels service-to-service
  const { data: adminProfiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);
  const adminUserId = adminProfiles?.[0]?.id || null;

  const results: Array<{ batch_id: string; type: string; status: string; detail?: unknown }> = [];
  let finalized = 0;

  // Anthropic Batch API rate limit : 5 requests/min → delay ~13s entre chaque
  // check pour rester sous la limite. Chaque batch ici declenche potentiellement
  // 2 calls Anthropic (check status + fetch results si ended).
  const ANTHROPIC_CALL_DELAY_MS = 13_000;
  let isFirstAnthropicCheck = true;

  for (const batch of pending as BatchRow[]) {
    const callsAnthropic =
      batch.batch_type === "scoring" ||
      batch.batch_type === "prospect_messages";
    if (callsAnthropic && !isFirstAnthropicCheck) {
      await new Promise(r => setTimeout(r, ANTHROPIC_CALL_DELAY_MS));
    }
    if (callsAnthropic) isFirstAnthropicCheck = false;

    try {
      let endpoint: string;
      let body: Record<string, unknown>;

      if (batch.batch_type === "scoring") {
        endpoint = `${supabaseUrl}/functions/v1/score-prospect-signals`;
        body = { check_batch: batch.batch_id, user_id: adminUserId };
      } else {
        // prospect_messages
        endpoint = `${supabaseUrl}/functions/v1/generate-prospect-messages-bulk`;
        body = { mode: "check-batch", batch_id: batch.batch_id, user_id: adminUserId };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      // Determiner si le batch est termine.
      // score-prospect-signals : { status: 'ended' | ..., scored, request_counts }
      // generate-prospect-messages-bulk : { done: true/false, inserted, failed }
      const isEnded = batch.batch_type === "scoring"
        ? data.status === "ended"
        : data.done === true;

      if (!res.ok) {
        await supabase
          .from("prospect_batches")
          .update({
            last_polled_at: new Date().toISOString(),
            error: JSON.stringify(data).slice(0, 500),
          })
          .eq("id", batch.id);

        results.push({ batch_id: batch.batch_id, type: batch.batch_type, status: "error", detail: data });
        continue;
      }

      if (!isEnded) {
        // Mettre à jour la progression même si le batch n'est pas fini
        let interim_processed: number = 0;
        let interim_failed: number = 0;
        if (batch.batch_type === "scoring" && data.request_counts) {
          interim_processed = data.request_counts.succeeded ?? 0;
          interim_failed = (data.request_counts.errored ?? 0) + (data.request_counts.canceled ?? 0) + (data.request_counts.expired ?? 0);
        }

        await supabase
          .from("prospect_batches")
          .update({
            last_polled_at: new Date().toISOString(),
            processed_count: interim_processed > 0 ? interim_processed : undefined,
            failed_count: interim_failed > 0 ? interim_failed : undefined,
          })
          .eq("id", batch.id);

        results.push({
          batch_id: batch.batch_id,
          type: batch.batch_type,
          status: "pending",
          detail: data.request_counts || data.processing_status,
        });
        continue;
      }

      let processed_count: number;
      let failed_count: number;
      if (batch.batch_type === "scoring") {
        processed_count = data.scored ?? 0;
        failed_count = (data.request_counts?.errored ?? 0) + (data.request_counts?.canceled ?? 0) + (data.request_counts?.expired ?? 0);
      } else {
        // prospect_messages
        processed_count = data.inserted ?? 0;
        failed_count = data.failed ?? 0;
      }

      await supabase
        .from("prospect_batches")
        .update({
          status: "ended",
          processed_at: new Date().toISOString(),
          last_polled_at: new Date().toISOString(),
          processed_count,
          failed_count,
          error: null,
        })
        .eq("id", batch.id);

      finalized++;
      results.push({
        batch_id: batch.batch_id,
        type: batch.batch_type,
        status: "ended",
        detail: { processed_count, failed_count },
      });
    } catch (err) {
      console.error(`[poll-prospect-batches] error on ${batch.batch_id}:`, err);
      await supabase
        .from("prospect_batches")
        .update({
          last_polled_at: new Date().toISOString(),
          error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        })
        .eq("id", batch.id);
      results.push({
        batch_id: batch.batch_id,
        type: batch.batch_type,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify({ pending: pending.length, finalized, results }, null, 2),
    {
      status: 200,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    }
  );
});

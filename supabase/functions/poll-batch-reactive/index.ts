import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * poll-batch-reactive
 *
 * Poll un batch Anthropic unique avec un delai avant le check, puis se
 * re-invoque avec backoff exponentiel tant que le batch n'est pas termine.
 *
 * Appele fire-and-forget par les fonctions qui soumettent un batch
 * (score-prospect-signals, generate-prospect-messages-bulk) pour recuperer
 * les resultats des qu'ils sont disponibles plutot que d'attendre le cron
 * poll-prospect-batches qui tourne toutes les 10 min.
 *
 * Schedule backoff : 30s → 45s → 60s → 90s → 120s (max 5 attempts, ~6 min total).
 * Au-dela, le cron prend le relais.
 *
 * Input : { batch_row_id: string, attempt?: number }
 *   - batch_row_id = uuid de la ligne prospect_batches
 *   - attempt defaut 1
 */

interface Body {
  batch_row_id: string;
  attempt?: number;
}

// Schéma de validation Zod pour poll-batch-reactive
const PollBatchReactiveRequestSchema = z.object({
  batch_row_id: z.string().uuid(),
  attempt: z.number().int().min(1).optional(),
});

const DELAYS_SECONDS = [30, 45, 60, 90, 120]; // max 5 tentatives
const MAX_ATTEMPTS = DELAYS_SECONDS.length;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth : accepte seulement le service_role pour eviter les abus.
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<Body>;
  const _validation = validateOrRespond(PollBatchReactiveRequestSchema, body, corsHeaders, "strict", { functionName: "poll-batch-reactive" });
  if (_validation.response) return _validation.response;

  const batchRowId = _validation.data.batch_row_id;
  const attempt = Math.max(1, _validation.data.attempt || 1);

  const delaySec = DELAYS_SECONDS[attempt - 1] ?? DELAYS_SECONDS[DELAYS_SECONDS.length - 1];
  console.log(`[poll-batch-reactive] batch=${batchRowId} attempt=${attempt}/${MAX_ATTEMPTS} delay=${delaySec}s`);

  await new Promise((r) => setTimeout(r, delaySec * 1000));

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: batch, error: fetchErr } = await supabase
    .from("prospect_batches")
    .select("id, batch_id, batch_type, status")
    .eq("id", batchRowId)
    .maybeSingle();

  if (fetchErr || !batch) {
    console.warn(`[poll-batch-reactive] batch ${batchRowId} not found: ${fetchErr?.message}`);
    return new Response(JSON.stringify({ error: "batch not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (batch.status !== "in_progress") {
    console.log(`[poll-batch-reactive] batch ${batch.batch_id} already ${batch.status}, stopping`);
    return new Response(JSON.stringify({ status: batch.status, stopped: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Demande a poll-prospect-batches de check CE batch. Plus simple que de
  // dupliquer la logique de dispatch par batch_type.
  try {
    await fetch(`${supabaseUrl}/functions/v1/poll-prospect-batches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ only_batch_row_id: batchRowId }),
    });
  } catch (pollErr) {
    console.warn(
      `[poll-batch-reactive] poll-prospect-batches failed: ${pollErr instanceof Error ? pollErr.message : pollErr}`
    );
  }

  // Re-check status apres le poll
  const { data: afterPoll } = await supabase
    .from("prospect_batches")
    .select("status")
    .eq("id", batchRowId)
    .maybeSingle();

  if (afterPoll?.status !== "in_progress") {
    console.log(`[poll-batch-reactive] batch ${batch.batch_id} became ${afterPoll?.status} after poll, done`);
    return new Response(JSON.stringify({ status: afterPoll?.status, done: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Toujours in_progress : re-schedule si budget restant
  if (attempt < MAX_ATTEMPTS) {
    // Fire-and-forget : on ne await pas, cette function peut rentrer avant
    // que le self-invoke parte. On utilise EdgeRuntime.waitUntil pour que
    // le fetch soit bien envoye.
    const nextBody = JSON.stringify({ batch_row_id: batchRowId, attempt: attempt + 1 });
    const selfInvoke = fetch(`${supabaseUrl}/functions/v1/poll-batch-reactive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: nextBody,
    }).catch((err) => {
      console.warn(`[poll-batch-reactive] self-invoke failed: ${err instanceof Error ? err.message : err}`);
    });
    // @ts-ignore -- EdgeRuntime global fourni par Supabase
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore -- EdgeRuntime global fourni par le runtime Supabase
      EdgeRuntime.waitUntil(selfInvoke);
    }

    return new Response(
      JSON.stringify({ status: "in_progress", scheduled_next: attempt + 1 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(
    `[poll-batch-reactive] batch ${batch.batch_id} still in_progress after ${MAX_ATTEMPTS} attempts, handing over to cron`
  );
  return new Response(
    JSON.stringify({ status: "in_progress", handoff_to_cron: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

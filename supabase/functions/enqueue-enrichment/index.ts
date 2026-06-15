import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveUserWorkspace } from "../_shared/workspace.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * enqueue-enrichment
 *
 * Cree un job d'enrichissement backend + ses items, puis amorce `concurrency`
 * workers via pg_net. Chaque worker (= une invocation de enrich-company avec
 * body.job_id) traite UN signal puis re-dispatche un nouveau worker tant qu'il
 * reste des items — la chain se maintient seule jusqu'a ce que le job soit
 * vide, sans depasser les limites de duree d'une edge function.
 *
 * Retourne immediatement `{ job_id, total, concurrency }` : le navigateur peut
 * fermer l'onglet, le boulot continue en backend.
 *
 * Auth : admin uniquement.
 */

interface EnqueueBody {
  signal_ids: string[];
  /** Nombre de workers paralleles (default 5, max 10 par la CHECK de la table). */
  concurrency?: number;
}

const EnqueueEnrichmentRequestSchema = z.object({
  signal_ids: z.array(z.string().uuid()),
  concurrency: z.number().int().min(1).max(10).optional(),
}).passthrough();

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // INTERNAL_WORKER_JWT = JWT legacy service_role pour les appels internes
    // edge function -> edge function via pg_net. La nouvelle clé `sb_secret_*`
    // exposee par SUPABASE_SERVICE_ROLE_KEY est rejetee par le gateway
    // verify_jwt=true (qui n'accepte que des JWT). Cf 2026-04-28 fix worker auth.
    const workerJwt = Deno.env.get("INTERNAL_WORKER_JWT") || serviceRoleKey;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Admin only" }, 403, corsHeaders);
    }

    const body = (await req.json()) as EnqueueBody;
    const _validation = validateOrRespond(EnqueueEnrichmentRequestSchema, body, corsHeaders, "strict", { functionName: "enqueue-enrichment" });
    if (_validation.response) return _validation.response;

    const rawIds = Array.isArray(body.signal_ids) ? body.signal_ids : [];
    // Dedup + filter empty : evite d'insere 2x le meme signal dans un job
    const signalIds = Array.from(new Set(rawIds.filter(Boolean)));
    if (signalIds.length === 0) {
      return json({ error: "signal_ids required (non-empty array)" }, 400, corsHeaders);
    }

    const concurrency = Math.min(Math.max(body.concurrency ?? 5, 1), 10);

    // Idempotence : refuse si un job actif existe deja pour cet user.
    // Evite le double-fire (deux onglets, double-clic) qui creait 2 jobs
    // avec les memes signaux → enrichissement duplique + credits FullEnrich
    // crames.
    const { data: existingJob } = await supabase
      .from("prospect_enrichment_jobs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .limit(1)
      .maybeSingle();
    if (existingJob) {
      return json(
        { error: "Un enrichissement est deja en cours, attends qu'il termine", job_id: existingJob.id },
        409,
        corsHeaders,
      );
    }

    const workspaceId = await resolveUserWorkspace(supabase, userId);
    if (!workspaceId) {
      return json({ error: "No workspace membership for user" }, 403, corsHeaders);
    }

    // Cree le job
    const { data: job, error: jobError } = await supabase
      .from("prospect_enrichment_jobs")
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        status: "pending",
        concurrency,
        total: signalIds.length,
      })
      .select("id")
      .single();
    if (jobError || !job) {
      throw new Error(`Failed to create job: ${jobError?.message}`);
    }

    // Cree les items (UNIQUE(job_id, signal_id) dedupe si jamais)
    const items = signalIds.map(signal_id => ({
      job_id: job.id,
      workspace_id: workspaceId,
      signal_id,
      status: "pending" as const,
    }));
    const { error: itemsError } = await supabase
      .from("prospect_enrichment_job_items")
      .insert(items);
    if (itemsError) {
      // Rollback le job si les items n'ont pas ete crees
      await supabase.from("prospect_enrichment_jobs").delete().eq("id", job.id);
      throw new Error(`Failed to create items: ${itemsError.message}`);
    }

    console.log(
      `[enqueue-enrichment] Created job ${job.id} with ${signalIds.length} items, spawning ${concurrency} workers`
    );

    // Amorce `concurrency` workers en parallele via pg_net (fire-and-forget).
    // Chaque worker va piocher un item via claim_next_enrichment_item et
    // re-dispatcher un nouveau worker a la fin tant que remaining > 0.
    const spawnCalls = Array.from({ length: Math.min(concurrency, signalIds.length) }, () =>
      supabase.rpc("spawn_enrichment_worker", {
        p_functions_url: supabaseUrl + "/functions/v1",
        p_service_role_key: workerJwt,
        p_job_id: job.id,
      }).then(r => {
        if (r.error) console.error(`[enqueue-enrichment] spawn failed:`, r.error.message);
        return r;
      })
    );
    await Promise.all(spawnCalls);

    return json({
      job_id: job.id,
      total: signalIds.length,
      concurrency,
      status: "pending",
    }, 200, corsHeaders);

  } catch (err) {
    console.error("[enqueue-enrichment] Error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
      getCorsHeaders(req.headers.get("origin")),
    );
  }
});

function json(payload: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

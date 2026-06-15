import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";

/**
 * Weekly prospection cron — runs Sunday night (22:00 UTC).
 *
 * Egalement declenche manuellement via le bouton "Lancer un run" dans l'UI
 * admin. Cron et manuel font exactement la meme chose : scrape + score.
 *
 * Orchestration :
 * 1. Scrape job offers (France Travail + Adzuna) — avec dedup cross-semaine
 *    pour ne pas re-injecter une boite deja traitee la semaine precedente.
 * 2. Submit scoring batch (Anthropic Batch API) -> tracked in prospect_batches
 *
 * Note : le scrape LinkedIn (Apify Dir Co) etait en step 2 mais a ete retire
 * car on ne s'en sert plus pour la recherche d'entreprises (FT + Adzuna couvrent
 * deja le besoin via les offres d'emploi). Les profils LinkedIn sont desormais
 * recuperes uniquement a l'enrichissement (enrich-company → Apify profile).
 *
 * Pas de wipe automatique de la DB : Alex peut ne pas avoir fini de traiter
 * les boites de la semaine d'avant. Le wipe total est disponible
 * manuellement via le menu "..." dans l'UI admin (appelle wipe-prospection-db).
 *
 * Apres le run, Alex voit la liste scoree (max 15) dans l'UI, selectionne
 * les boites a contacter et lance l'enrichissement + generation de messages
 * via la queue front. Plus de generation automatique de messages LinkedIn
 * dans le cron.
 *
 * Les batches Anthropic sont asynchrones (30-60 min). Ils sont finalises
 * par poll-prospect-batches (cron toutes les 10 min) qui ecrit les scores.
 *
 * L'email business recapitulatif est envoye lundi 07:00 UTC (9h Paris ete)
 * par prospect-weekly-recap, une fois que les batches sont traites.
 */

interface CronResult {
  step: string;
  success: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (!isCronCall) {
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: getCorsHeaders(req.headers.get("origin")),
      });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: getCorsHeaders(req.headers.get("origin")),
      });
    }
  }

  const runId = crypto.randomUUID();
  const results: CronResult[] = [];
  const startTime = Date.now();

  console.log(`[weekly-prospect-cron] Starting run ${runId}`);

  const { data: adminProfiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);
  const adminUserId = adminProfiles?.[0]?.id || null;
  if (!adminUserId) {
    console.warn("[weekly-prospect-cron] No admin user found — service calls may fail");
  }

  // Resout le workspace de l'admin pour tagger les batches (multi-tenant)
  let adminWorkspaceId: string | null = null;
  if (adminUserId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", adminUserId)
      .limit(1)
      .maybeSingle();
    adminWorkspaceId = (membership?.workspace_id as string) ?? null;
  }

  // Step 1: Scrape job signals
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/scrape-job-signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: "{}",
    });
    const data = await res.json();
    results.push({
      step: "scrape-job-signals",
      success: res.ok,
      details: { total_inserted: data.total_inserted, scrapers: Object.keys(data.results || {}) },
      error: res.ok ? undefined : JSON.stringify(data),
    });
  } catch (err) {
    results.push({
      step: "scrape-job-signals",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 2: Submit scoring batch
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/score-prospect-signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ user_id: adminUserId }),
    });
    const data = await res.json();
    const batchId = data.batch_id || null;

    if (res.ok && batchId) {
      const { data: inserted, error: insertErr } = await supabase
        .from("prospect_batches")
        .insert({
          run_id: runId,
          batch_id: batchId,
          batch_type: "scoring",
          total: data.total ?? null,
          workspace_id: adminWorkspaceId,
        })
        .select("id")
        .maybeSingle();
      if (insertErr) {
        console.error(`[weekly-prospect-cron] prospect_batches insert failed: ${insertErr.message}`);
      }

      // Fire-and-forget : poll reactif avec backoff expo pour recuperer les
      // resultats des que le batch termine, sans attendre le cron 10min.
      if (inserted?.id) {
        fetch(`${supabaseUrl}/functions/v1/poll-batch-reactive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ batch_row_id: inserted.id, attempt: 1 }),
        }).catch((err) => {
          console.warn(`[weekly-prospect-cron] reactive poll submit failed: ${err instanceof Error ? err.message : err}`);
        });
      }
    }

    results.push({
      step: "score-prospect-signals-submit",
      success: res.ok,
      details: { batch_id: batchId, total: data.total },
      error: res.ok ? undefined : JSON.stringify(data),
    });
  } catch (err) {
    results.push({
      step: "score-prospect-signals-submit",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Note : plus de Step 3b (generation messages LinkedIn automatique). Les
  // messages sont desormais generes a la demande apres selection manuelle
  // des signaux scores dans l'UI -> runEnrichmentQueue (front) ->
  // enrich-company -> generate-prospect-messages-bulk.

  const duration_s = Math.round((Date.now() - startTime) / 1000);
  console.log(`[weekly-prospect-cron] Run ${runId} done in ${duration_s}s`);

  return new Response(
    JSON.stringify({
      success: results.every(r => r.success),
      run_id: runId,
      duration_s,
      results,
    }, null, 2),
    {
      status: 200,
      headers: {
        ...getCorsHeaders(req.headers.get("origin")),
        "Content-Type": "application/json",
      },
    }
  );
});

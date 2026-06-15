import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * reenrich-companies
 *
 * Reset complet + relance de l'enrichissement sur les entreprises deja
 * en base. Pour chaque company_group_id fourni (ou toutes si vide) :
 *   1. Collecte les source_signal_id associes (distincts, pas null)
 *   2. DELETE prospect_profiles du group → cascade prospect_messages + actions
 *   3. UPDATE prospect_signals.status = 'raw' sur ces signaux
 *   4. Retourne la liste des signal_ids a re-enrichir
 *
 * Le front appelle ensuite enqueueEnrichment(signal_ids) pour passer
 * chaque signal dans le pipeline complet (FullEnrich + INSEE + Apify +
 * templates messages) via la queue backend.
 *
 * Auth : JWT admin, CRON_SECRET, ou service_role.
 */

interface ReenrichBody {
  company_group_ids?: string[]; // Si vide, traite toutes les companies enrichies
}

// Schéma de validation Zod pour reenrich-companies
const ReenrichCompaniesRequestSchema = z.object({
  company_group_ids: z.array(z.string().uuid()).optional(),
  force: z.boolean().optional(),
});

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCronCall && !isServiceRole) {
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
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
        headers: corsHeaders,
      });
    }
  }

  let body: ReenrichBody & { force?: boolean } = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }
  }

  const _validation = validateOrRespond(ReenrichCompaniesRequestSchema, body, corsHeaders, "strict", { functionName: "reenrich-companies" });
  if (_validation.response) return _validation.response;

  // Guard : refuse si un run d'enrichissement est deja en cours pour eviter
  // les double-runs (cascade delete → perte des messages du run en cours).
  // Override avec { force: true } pour debloquer une situation coincee.
  if (!_validation.data.force) {
    const { data: runningBatches } = await supabase
      .from("prospect_batches")
      .select("id, batch_type, submitted_at")
      .eq("status", "in_progress")
      .in("batch_type", ["prospect_messages", "linkedin_message", "scoring"])
      .gte("submitted_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    if (runningBatches && runningBatches.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Enrichissement deja en cours",
          message: `${runningBatches.length} batch(es) Claude encore 'in_progress' (moins de 30min). Attendre la finalisation ou passer { force: true } pour ignorer.`,
          running_batches: runningBatches.length,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  // 1. Resolve target companies
  let groupIds: string[];
  if (_validation.data.company_group_ids && _validation.data.company_group_ids.length > 0) {
    groupIds = _validation.data.company_group_ids;
  } else {
    const { data } = await supabase
      .from("prospect_profiles")
      .select("company_group_id");
    groupIds = Array.from(
      new Set((data || []).map((p) => p.company_group_id).filter(Boolean))
    );
  }

  if (groupIds.length === 0) {
    return new Response(
      JSON.stringify({ companies: 0, signals: 0, message: "No companies to reenrich" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[reenrich-companies] Target: ${groupIds.length} companies`);

  // 2. Collect source_signal_ids for these companies
  const { data: profiles } = await supabase
    .from("prospect_profiles")
    .select("source_signal_id, company_group_id, company_name")
    .in("company_group_id", groupIds);

  const signalIds = Array.from(
    new Set((profiles || []).map((p) => p.source_signal_id).filter(Boolean))
  );
  const companyNames = Array.from(
    new Set((profiles || []).map((p) => p.company_name).filter(Boolean))
  );

  console.log(
    `[reenrich-companies] Found ${signalIds.length} source_signals, companies: ${companyNames.join(", ")}`
  );

  // 3. Delete profiles (cascade messages + actions)
  const { error: deleteErr, count: deleted } = await supabase
    .from("prospect_profiles")
    .delete({ count: "exact" })
    .in("company_group_id", groupIds);

  if (deleteErr) {
    return new Response(
      JSON.stringify({ error: `Delete failed: ${deleteErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[reenrich-companies] Deleted ${deleted} profiles`);

  // 4. Reset signals to 'raw' so they can be reenriched
  if (signalIds.length > 0) {
    const { error: updateErr } = await supabase
      .from("prospect_signals")
      .update({ status: "raw" })
      .in("id", signalIds);

    if (updateErr) {
      console.warn(
        `[reenrich-companies] Signal reset failed: ${updateErr.message}`
      );
    } else {
      console.log(`[reenrich-companies] Reset ${signalIds.length} signals to raw`);
    }
  }

  return new Response(
    JSON.stringify({
      companies: groupIds.length,
      company_names: companyNames,
      signal_ids: signalIds,
      profiles_deleted: deleted ?? 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

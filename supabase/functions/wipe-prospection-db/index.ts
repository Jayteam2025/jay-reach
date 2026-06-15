import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";

/**
 * wipe-prospection-db
 *
 * Reset total de la feature prospection. Vide :
 *   - prospect_profiles (cascade → prospect_messages + prospect_actions)
 *   - prospect_signals (les scrapes bruts/scores)
 *   - prospect_batches (Anthropic runs en cours ou termines)
 *   - prospect_scraping_logs (historique scraping)
 *
 * Conserve : prospect_templates, prospect_icp_filters, prospect_sequences,
 *            prospect_data_access_logs (audit).
 *
 * Utilise avant chaque nouveau run pour repartir propre. Appele par
 * weekly-prospect-cron au debut du run hebdomadaire, et par le bouton
 * "Lancer un run" depuis l'UI admin.
 *
 * Auth : JWT admin, CRON_SECRET, ou service_role.
 */

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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Ordre : profiles d'abord pour cascade messages+actions, puis signals,
  // puis batches. On utilise count:'exact' pour retourner les totaux.
  // `.neq('id', '00000000-0000-0000-0000-000000000000')` est un moyen robuste
  // d'exiger une clause WHERE (PostgREST refuse les DELETE sans filtre).
  const nullUuid = "00000000-0000-0000-0000-000000000000";
  const tables = [
    "prospect_profiles",
    "prospect_signals",
    "prospect_batches",
    "prospect_scraping_logs",
  ] as const;

  const deleted: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .neq("id", nullUuid);

    if (error) {
      errors[table] = error.message;
      console.error(`[wipe-prospection-db] ${table} failed:`, error.message);
    } else {
      deleted[table] = count ?? 0;
      console.log(`[wipe-prospection-db] ${table}: deleted ${count ?? 0} rows`);
    }
  }

  const anyError = Object.keys(errors).length > 0;
  return new Response(
    JSON.stringify({ success: !anyError, deleted, errors }, null, 2),
    {
      status: anyError ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});

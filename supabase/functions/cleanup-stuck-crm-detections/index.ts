import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

/**
 * cleanup-stuck-crm-detections
 *
 * Marque comme "failed" les rows de prospect_crm_detections qui sont
 * restées en "pending" > 5 minutes. Appelé par pg_cron toutes les 5 minutes.
 *
 * Auth: CRON_SECRET ou SERVICE_ROLE_KEY
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` || authHeader === `Bearer ${serviceRoleKey}`;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Rows stuck en "pending" depuis plus de 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("prospect_crm_detections")
    .update({
      detection_status: "failed",
      error: "timeout: detection stuck in pending > 5min",
      crm_confidence: "none",
    })
    .eq("detection_status", "pending")
    .lt("updated_at", fiveMinAgo)
    .select("company_group_id");

  if (error) {
    console.error("[cleanup-stuck-crm-detections] error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  const markedCount = data?.length ?? 0;
  console.log(`[cleanup-stuck-crm-detections] marked ${markedCount} rows as failed`);

  return new Response(JSON.stringify({ marked_failed: markedCount }), {
    status: 200,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
});

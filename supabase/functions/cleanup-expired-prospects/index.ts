import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * GDPR Retention policy: soft-delete prospects based on their status
 * and time since creation/last update.
 */
const RETENTION_DAYS: Record<string, number> = {
  new: 90,
  qualified: 180,
  in_sequence: 180,
  replied: 365,
  meeting_booked: 365,
  lost: 60,
  converted: 1095, // 3 years
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  try {
    console.log("🧹 Nettoyage GDPR des prospects expirés...");

    const now = new Date().toISOString();
    let softDeletedCount = 0;

    // Soft-delete expired prospects by status
    for (const [status, days] of Object.entries(RETENTION_DAYS)) {
      // Use created_at for 'new' status, updated_at for all others
      const dateColumn = status === "new" ? "created_at" : "updated_at";

      const { error: deleteError, data } = await supabase
        .from("prospect_profiles")
        .update({ deleted_at: now })
        .eq("status", status)
        .is("deleted_at", null)
        .lt(dateColumn, `now() - interval '${days} days'`)
        .select("id");

      if (deleteError) {
        console.error(
          `Erreur lors du soft-delete des prospects '${status}':`,
          deleteError
        );
        throw deleteError;
      }

      const deletedInStatus = data?.length || 0;
      softDeletedCount += deletedInStatus;
      console.log(
        `✅ ${deletedInStatus} prospect(s) '${status}' soft-supprimé(s) (>= ${days} jours)`
      );
    }

    // Purge old scraping logs (90 days)
    const { error: purgeError, count: logsPurged } = await supabase
      .from("prospect_scraping_logs")
      .delete()
      .lt("created_at", `now() - interval '90 days'`)
      .select("id", { count: "exact", head: true });

    if (purgeError) {
      console.warn(
        "Avertissement : erreur lors de la purge des logs de scraping:",
        purgeError
      );
      // Continue - don't fail the entire cleanup
    } else {
      console.log(`🗑️ ${logsPurged || 0} log(s) de scraping supprimé(s)`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Nettoyage GDPR des prospects expirés terminé",
        results: {
          soft_deleted: softDeletedCount,
          logs_purged: logsPurged || 0,
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(req.headers.get("origin")),
        },
        status: 200,
      }
    );
  } catch (error) {
    console.error("❌ Erreur lors du nettoyage GDPR:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(req.headers.get("origin")),
        },
        status: 500,
      }
    );
  }
});

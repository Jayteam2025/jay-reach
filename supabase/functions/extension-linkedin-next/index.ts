// Edge function : poll par l'extension Chrome pour recuperer la prochaine
// invitation LinkedIn a envoyer. Applique le rate-limit :
//   - Max 200 sent dans les 7 jours glissants par user
//   - Intervalle aleatoire 1-20min entre 2 sends (deterministe par hash du
//     dernier sent_at, pour que chaque poll retombe sur le meme intervalle)
//   - Fenetre 8h-21h Europe/Paris (tous les jours)
//
// Auth : token extension via validate_extension_token RPC.
// Output: { invitation: { id, linkedin_url } } ou { invitation: null, reason: '...' }
// Cote extension : si invitation != null, faire le call Voyager API puis appeler
// extension-linkedin-update avec le resultat.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const MAX_PER_7_DAYS = 200;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 20;
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 21;
const PROCESSING_TIMEOUT_MINUTES = 10;

// Hash stable d'une string vers un float [0, 1). Utilise pour deriver un
// intervalle deterministe a partir du timestamp du dernier envoi : a chaque
// poll on retombe sur le meme intervalle cible pour le meme sent_at.
function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== "string") {
      return json({ error: "Token required" }, 400, corsHeaders);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userId, error: tokenErr } = await supabase.rpc("validate_extension_token", {
      p_token: token,
    });
    if (tokenErr || !userId) {
      return json({ error: "Invalid token" }, 401, corsHeaders);
    }

    // 1. Re-queue items stuck in processing (extension may have died mid-call)
    const stuckCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MINUTES * 60_000).toISOString();
    await supabase
      .from("linkedin_invitation_queue")
      .update({ status: "pending", processing_started_at: null })
      .eq("user_id", userId)
      .eq("status", "processing")
      .lt("processing_started_at", stuckCutoff);

    // 2. Check time window (Europe/Paris)
    const parisHour = getParisHour();
    if (parisHour < WINDOW_START_HOUR || parisHour >= WINDOW_END_HOUR) {
      return json(
        { invitation: null, reason: "outside_window", paris_hour: parisHour },
        200,
        corsHeaders,
      );
    }

    // 3. Check weekly cap
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const { count: sentLast7d, error: countErr } = await supabase
      .from("linkedin_invitation_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent")
      .gte("sent_at", sevenDaysAgo);
    if (countErr) {
      console.error("Count query failed:", countErr);
      return json({ error: "Count query failed" }, 500, corsHeaders);
    }
    if ((sentLast7d || 0) >= MAX_PER_7_DAYS) {
      return json(
        { invitation: null, reason: "weekly_cap_reached", sent_last_7d: sentLast7d },
        200,
        corsHeaders,
      );
    }

    // 4. Check min interval since last send
    const { data: lastSent } = await supabase
      .from("linkedin_invitation_queue")
      .select("sent_at")
      .eq("user_id", userId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSent?.sent_at) {
      const intervalRange = MAX_INTERVAL_MINUTES - MIN_INTERVAL_MINUTES;
      const targetIntervalMin =
        MIN_INTERVAL_MINUTES + seededRandom(lastSent.sent_at) * intervalRange;
      const minutesSinceLast = (Date.now() - new Date(lastSent.sent_at).getTime()) / 60_000;
      if (minutesSinceLast < targetIntervalMin) {
        return json(
          {
            invitation: null,
            reason: "too_soon",
            wait_minutes: Math.ceil(targetIntervalMin - minutesSinceLast),
            target_interval_min: Math.round(targetIntervalMin * 10) / 10,
          },
          200,
          corsHeaders,
        );
      }
    }

    // 5. Pick next pending item (oldest scheduled_for first), claim it via update
    const { data: candidate, error: pickErr } = await supabase
      .from("linkedin_invitation_queue")
      .select("id, linkedin_url")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("method", "extension_auto")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) {
      console.error("Pick query failed:", pickErr);
      return json({ error: "Pick query failed" }, 500, corsHeaders);
    }
    if (!candidate) {
      return json({ invitation: null, reason: "queue_empty" }, 200, corsHeaders);
    }

    // Atomic claim : only succeed if still pending (prevents double-pickup)
    const { data: claimed, error: claimErr } = await supabase
      .from("linkedin_invitation_queue")
      .update({
        status: "processing",
        processing_started_at: new Date().toISOString(),
        attempts: 1,
      })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("id, linkedin_url")
      .maybeSingle();

    if (claimErr || !claimed) {
      // Race condition : someone else picked it. Tell extension to retry shortly.
      return json({ invitation: null, reason: "race_retry" }, 200, corsHeaders);
    }

    return json(
      {
        invitation: {
          id: claimed.id,
          linkedin_url: claimed.linkedin_url,
        },
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: "Server error", details: msg }, 500, corsHeaders);
  }
});

function getParisHour(): number {
  // Intl.DateTimeFormat handles DST correctly
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? parseInt(hourPart.value, 10) : 12;
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

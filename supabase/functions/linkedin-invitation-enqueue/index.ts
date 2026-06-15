// Edge function : enqueue de contacts LinkedIn pour invitation automatique.
// Appele depuis l'UI Jay (auth user JWT, admin only via RLS).
// Input: { signal_ids?: string[], prospect_ids?: string[], method?: 'extension_auto' | 'cowork_csv' }
// Output: { enqueued: number, skipped: {...}, total_requested: number }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

interface RequestBody {
  signal_ids?: unknown;
  prospect_ids?: unknown;
  method?: unknown;
}

const LinkedInInvitationEnqueueRequestSchema = z.object({
  signal_ids: z.array(z.string()).optional(),
  prospect_ids: z.array(z.string()).optional(),
  method: z.enum(["extension_auto", "cowork_csv"]).optional(),
}).passthrough();

interface SkipReasons {
  no_linkedin_url: number;
  not_found: number;
  already_in_queue: number;
  not_linkedin_signal: number;
}

type Insertable = {
  signal_id: string | null;
  prospect_id: string | null;
  user_id: string;
  linkedin_url: string;
  method: string;
};

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { userId, error: authErr } = await extractUserId(supabase, req);
    if (!userId) {
      return json({ error: authErr || "Unauthorized" }, 401, corsHeaders);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Admin only" }, 403, corsHeaders);
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const _validation = validateOrRespond(
      LinkedInInvitationEnqueueRequestSchema,
      body,
      corsHeaders,
      "strict",
      { functionName: "linkedin-invitation-enqueue" }
    );
    if (_validation.response) return _validation.response;
    const signalIds = Array.isArray(_validation.data.signal_ids)
      ? _validation.data.signal_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const prospectIds = Array.isArray(_validation.data.prospect_ids)
      ? _validation.data.prospect_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const method = _validation.data.method === "cowork_csv" ? "cowork_csv" : "extension_auto";

    if (signalIds.length === 0 && prospectIds.length === 0) {
      return json(
        { error: "signal_ids or prospect_ids required (non-empty array)" },
        400,
        corsHeaders,
      );
    }
    if (signalIds.length + prospectIds.length > 500) {
      return json({ error: "Max 500 ids per call (signal+prospect combined)" }, 400, corsHeaders);
    }

    const skipped: SkipReasons = {
      no_linkedin_url: 0,
      not_found: 0,
      already_in_queue: 0,
      not_linkedin_signal: 0,
    };
    const toInsert: Insertable[] = [];

    if (signalIds.length > 0) {
      const { data: signals, error: sigErr } = await supabase
        .from("prospect_signals")
        .select("id, source, extracted_data, source_url")
        .in("id", signalIds);

      if (sigErr) {
        console.error("Failed to fetch signals:", sigErr);
        return json({ error: "Failed to fetch signals" }, 500, corsHeaders);
      }

      const foundIds = new Set((signals || []).map((s) => s.id));
      skipped.not_found += signalIds.filter((id) => !foundIds.has(id)).length;

      const { data: existing } = await supabase
        .from("linkedin_invitation_queue")
        .select("signal_id")
        .eq("user_id", userId)
        .in("status", ["pending", "processing", "sent"])
        .in("signal_id", signalIds);
      const alreadyQueued = new Set((existing || []).map((e) => e.signal_id));

      for (const sig of signals || []) {
        if (sig.source !== "linkedin") {
          skipped.not_linkedin_signal++;
          continue;
        }
        if (alreadyQueued.has(sig.id)) {
          skipped.already_in_queue++;
          continue;
        }
        const ed = (sig.extracted_data || {}) as Record<string, unknown>;
        const url = (ed.linkedin_url as string) || sig.source_url || "";
        if (!url || !/linkedin\.com/i.test(url)) {
          skipped.no_linkedin_url++;
          continue;
        }
        toInsert.push({
          signal_id: sig.id,
          prospect_id: null,
          user_id: userId,
          linkedin_url: url.startsWith("http") ? url : `https://${url}`,
          method,
        });
      }
    }

    if (prospectIds.length > 0) {
      const { data: profiles, error: profErr } = await supabase
        .from("prospect_profiles")
        .select("id, linkedin_url")
        .in("id", prospectIds)
        .is("deleted_at", null);

      if (profErr) {
        console.error("Failed to fetch prospect profiles:", profErr);
        return json({ error: "Failed to fetch profiles" }, 500, corsHeaders);
      }

      const foundIds = new Set((profiles || []).map((p) => p.id));
      skipped.not_found += prospectIds.filter((id) => !foundIds.has(id)).length;

      const { data: existing } = await supabase
        .from("linkedin_invitation_queue")
        .select("prospect_id")
        .eq("user_id", userId)
        .in("status", ["pending", "processing", "sent"])
        .in("prospect_id", prospectIds);
      const alreadyQueued = new Set((existing || []).map((e) => e.prospect_id));

      for (const p of profiles || []) {
        if (alreadyQueued.has(p.id)) {
          skipped.already_in_queue++;
          continue;
        }
        const url = p.linkedin_url || "";
        if (!url || !/linkedin\.com/i.test(url)) {
          skipped.no_linkedin_url++;
          continue;
        }
        toInsert.push({
          signal_id: null,
          prospect_id: p.id,
          user_id: userId,
          linkedin_url: url.startsWith("http") ? url : `https://${url}`,
          method,
        });
      }
    }

    let enqueued = 0;
    if (toInsert.length > 0) {
      const { error: insErr, count } = await supabase
        .from("linkedin_invitation_queue")
        .insert(toInsert, { count: "exact" });
      if (insErr) {
        console.error("Insert failed:", insErr);
        return json({ error: "Insert failed", details: insErr.message }, 500, corsHeaders);
      }
      enqueued = count || toInsert.length;
    }

    return json(
      { enqueued, skipped, total_requested: signalIds.length + prospectIds.length },
      200,
      corsHeaders,
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: "Server error", details: msg }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

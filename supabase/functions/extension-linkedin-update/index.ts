// Edge function : appelee par l'extension Chrome apres tentative d'invit LinkedIn.
// Input: { token, queue_id, status: 'sent' | 'failed', error_message?, error_code? }
// - Met a jour la queue
// - Si sent : marque le prospect_signal extracted_data.contact_status = 'ajoute'
//   et stocke linkedin_invitation_sent_at + method
// - Si failed avec error_code='restricted' : log un warning fort (compte LinkedIn
//   potentiellement restreint, l'extension devrait s'auto-pause)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

interface RequestBody {
  token?: unknown;
  queue_id?: unknown;
  status?: unknown;
  error_message?: unknown;
  error_code?: unknown;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const token = typeof body.token === "string" ? body.token : null;
    const queueId = typeof body.queue_id === "string" ? body.queue_id : null;
    const status = body.status === "sent" || body.status === "failed" ? body.status : null;
    const errorMessage = typeof body.error_message === "string" ? body.error_message : null;
    const errorCode = typeof body.error_code === "string" ? body.error_code : null;

    if (!token) return json({ error: "Token required" }, 400, corsHeaders);
    if (!queueId) return json({ error: "queue_id required" }, 400, corsHeaders);
    if (!status) return json({ error: "status must be 'sent' or 'failed'" }, 400, corsHeaders);

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

    // Fetch queue item to get signal_id/prospect_id and verify ownership
    const { data: queueItem, error: fetchErr } = await supabase
      .from("linkedin_invitation_queue")
      .select("id, signal_id, prospect_id, user_id, status, method")
      .eq("id", queueId)
      .maybeSingle();

    if (fetchErr || !queueItem) {
      return json({ error: "Queue item not found" }, 404, corsHeaders);
    }
    if (queueItem.user_id !== userId) {
      return json({ error: "Forbidden" }, 403, corsHeaders);
    }
    if (queueItem.status !== "processing") {
      return json(
        { error: `Queue item not in processing state (current: ${queueItem.status})` },
        409,
        corsHeaders,
      );
    }

    // Update queue
    const update: Record<string, unknown> = { status };
    if (status === "sent") {
      update.sent_at = new Date().toISOString();
      update.error_message = null;
    } else {
      update.error_message = errorMessage || errorCode || "Unknown error";
    }

    const { error: updErr } = await supabase
      .from("linkedin_invitation_queue")
      .update(update)
      .eq("id", queueId);

    if (updErr) {
      console.error("Queue update failed:", updErr);
      return json({ error: "Update failed", details: updErr.message }, 500, corsHeaders);
    }

    // If sent : tracking selon la cible (signal LinkedIn vs prospect entreprise)
    if (status === "sent") {
      const sentAt = new Date().toISOString();

      if (queueItem.signal_id) {
        // Cas 1 : contact LinkedIn de l'onglet Contacts → update extracted_data
        const { data: signal } = await supabase
          .from("prospect_signals")
          .select("extracted_data")
          .eq("id", queueItem.signal_id)
          .maybeSingle();

        const ed = ((signal?.extracted_data as Record<string, unknown>) || {});
        const updated = {
          ...ed,
          contact_status: "ajoute",
          linkedin_invitation_sent_at: sentAt,
          linkedin_invitation_method: queueItem.method,
        };

        await supabase
          .from("prospect_signals")
          .update({ extracted_data: updated })
          .eq("id", queueItem.signal_id);
      }

      if (queueItem.prospect_id) {
        // Cas 2 : prospect de l'onglet Entreprises → update prospect_profiles
        // + insert dans prospect_actions pour que la barre de % se mette a jour
        const { data: prosp } = await supabase
          .from("prospect_profiles")
          .select("company_group_id, workspace_id")
          .eq("id", queueItem.prospect_id)
          .maybeSingle();

        await supabase
          .from("prospect_profiles")
          .update({
            linkedin_invited_at: sentAt,
            linkedin_invitation_method: queueItem.method,
          })
          .eq("id", queueItem.prospect_id);

        if (prosp?.company_group_id && prosp?.workspace_id) {
          await supabase
            .from("prospect_actions")
            .insert({
              prospect_id: queueItem.prospect_id,
              workspace_id: prosp.workspace_id,
              company_group_id: prosp.company_group_id,
              action_type: "sent",
              channel: "linkedin",
              metadata: { method: queueItem.method, source: "auto_invite" },
            });
        }
      }
    }

    if (status === "failed" && errorCode === "restricted") {
      console.error(
        `[LINKEDIN_RESTRICTED] User ${userId} compte potentiellement restreint. ` +
        `Queue item ${queueId}. Extension devrait s'auto-pause.`,
      );
    }

    return json({ ok: true }, 200, corsHeaders);
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

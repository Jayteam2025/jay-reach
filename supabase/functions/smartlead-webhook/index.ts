import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * smartlead-webhook
 *
 * Endpoint public appele par Smartlead a chaque event (sent/opened/replied/bounced/clicked).
 * Auth : un secret statique dans le query param ?secret=... (Smartlead ne signe pas les webhooks).
 *
 * Action :
 * - Stocke l'event brut dans smartlead_events
 * - Matche sur lead_email pour retrouver le prospect_id
 * - Logge une ligne dans prospect_actions (sent/opened/replied)
 *
 * Payload attendu Smartlead :
 * {
 *   "event_type": "REPLIED" | "OPENED" | "EMAIL_SENT" | "CLICKED" | "BOUNCED",
 *   "campaign_id": 123,
 *   "lead_email": "john@example.com",
 *   "lead_first_name": "...",
 *   "lead_last_name": "...",
 *   "email_account": "sender@example.com",
 *   "subject": "...",
 *   "message": "...",
 *   "timestamp": "2026-04-17T10:30:00Z"
 * }
 */

interface SmartleadEvent {
  event_type?: string;
  campaign_id?: number | string;
  lead_email?: string;
  lead_first_name?: string;
  lead_last_name?: string;
  email_account?: string;
  subject?: string;
  message?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Schéma de validation Zod pour Smartlead webhook (payload externe)
const SmartleadWebhookRequestSchema = z.object({
  event_type: z.string().optional(),
  campaign_id: z.union([z.number(), z.string()]).optional(),
  lead_email: z.string().optional(),
  lead_first_name: z.string().optional(),
  lead_last_name: z.string().optional(),
  email_account: z.string().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
  timestamp: z.string().optional(),
}).passthrough();

// Smartlead event -> prospect_actions.action_type
const EVENT_TO_ACTION: Record<string, string> = {
  EMAIL_SENT: "sent",
  LEAD_OPENED: "opened",
  OPENED: "opened",
  LEAD_REPLIED: "replied",
  REPLIED: "replied",
  LEAD_CLICKED: "clicked",
  CLICKED: "clicked",
  BOUNCED: "bounced",
  EMAIL_BOUNCED: "bounced",
};

// Smartlead event -> pattern_audit_events.event_type
const EVENT_TYPE_TO_AUDIT: Record<string, "sent" | "bounced" | "replied" | "opened"> = {
  EMAIL_SENT: "sent",
  LEAD_OPENED: "opened",
  OPENED: "opened",
  LEAD_REPLIED: "replied",
  REPLIED: "replied",
  BOUNCED: "bounced",
  EMAIL_BOUNCED: "bounced",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  // Auth : secret dans query param
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expectedSecret = Deno.env.get("SMARTLEAD_WEBHOOK_SECRET");

  if (!expectedSecret) {
    console.error("[smartlead-webhook] SMARTLEAD_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!secret || secret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: SmartleadEvent;
  try {
    payload = await req.json() as SmartleadEvent;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const _validation = validateOrRespond(SmartleadWebhookRequestSchema, payload, getCorsHeaders(req.headers.get("origin")), "strict", { functionName: "smartlead-webhook" });
  if (_validation.response) return _validation.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1. Resolve prospect_id via lead_email
    let prospectId: string | null = null;
    let companyGroupId: string | null = null;
    let workspaceId: string | null = null;
    if (payload.lead_email) {
      const { data: prospect } = await supabase
        .from("prospect_profiles")
        .select("id, company_group_id, workspace_id")
        .ilike("email", payload.lead_email)
        .limit(1)
        .maybeSingle();
      if (prospect) {
        prospectId = prospect.id as string;
        companyGroupId = (prospect.company_group_id as string) || null;
        workspaceId = (prospect.workspace_id as string) || null;
      }
    }

    // 2. Store raw event
    await supabase.from("smartlead_events").insert({
      prospect_id: prospectId,
      lead_email: payload.lead_email || null,
      campaign_id: typeof payload.campaign_id === "number" ? payload.campaign_id : (payload.campaign_id ? Number(payload.campaign_id) : null),
      event_type: payload.event_type || "UNKNOWN",
      subject: payload.subject || null,
      message: payload.message || null,
      email_account: payload.email_account || null,
      raw_payload: payload as unknown as Record<string, unknown>,
    });

    // 3. Log in prospect_actions if we matched a prospect
    const actionType = EVENT_TO_ACTION[payload.event_type || ""] || null;
    if (prospectId && actionType && workspaceId) {
      await supabase.from("prospect_actions").insert({
        prospect_id: prospectId,
        workspace_id: workspaceId,
        company_group_id: companyGroupId,
        action_type: actionType,
        channel: "email",
      });

      // Si REPLIED, update prospect_messages status
      if (actionType === "replied") {
        await supabase
          .from("prospect_messages")
          .update({ replied_at: new Date().toISOString(), status: "replied" })
          .eq("prospect_id", prospectId)
          .eq("channel", "email")
          .eq("status", "sent");
      }

      // 4. Mirror event to pattern_audit_events (silently fail if error)
      const auditEventType = EVENT_TYPE_TO_AUDIT[payload.event_type || ""];
      if (auditEventType && payload.lead_email) {
        const domain = payload.lead_email.split("@")[1]?.toLowerCase() ?? "";
        const { data: prof } = await supabase
          .from("prospect_profiles")
          .select("email_source")
          .eq("id", prospectId)
          .maybeSingle();
        const { error: auditErr } = await supabase.from("pattern_audit_events").insert({
          prospect_id: prospectId,
          email: payload.lead_email,
          domain,
          email_source: prof?.email_source ?? "unknown",
          event_type: auditEventType,
          event_value: payload.subject ?? null,
        });
        if (auditErr) {
          console.warn("[smartlead-webhook] pattern_audit_events insert failed:", auditErr.message);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, prospect_matched: !!prospectId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[smartlead-webhook] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

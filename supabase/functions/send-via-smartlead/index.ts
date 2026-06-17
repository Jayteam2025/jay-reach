import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { shouldPushToSmartlead, type GateInput } from "../_shared/email-gate.ts";
import { resolveOutreachProvider } from "../_shared/outreach/registry.ts";
import type { OutreachLead } from "../_shared/outreach/types.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * send-via-smartlead
 *
 * Ajoute un prospect a la campagne Smartlead correspondante (RH / Dir Co / commerciaux).
 * Le subject + body persos sont passes via custom_fields : {{subject}} et {{body}}
 * dans le template Smartlead liront ces custom fields.
 *
 * L'operateur doit avoir cree au prealable sa campagne dans Smartlead avec :
 * - Une sequence dont le step 1 utilise {{subject}} et {{body}} comme variables
 * - Le CV en piece jointe (upload manuel une fois)
 *
 * Body attendu :
 * {
 *   "prospect_id": "<uuid>",
 *   "channel": "email",
 *   "user_id"?: "<uuid>"   // requis si service_role auth
 * }
 */

const SendViaSmartleadRequestSchema = z.object({
  prospect_id: z.string().uuid().optional(),
  channel: z.string().optional(),
  user_id: z.string().uuid().optional(),
  dry_run: z.boolean().optional(),
  manual_override: z.boolean().optional(),
});

interface RequestBody {
  prospect_id?: string;
  channel?: string;
  user_id?: string;
  /** Si true : build le HTML complet (body + attachments inline) mais skip le push Smartlead. Retourne { body_html, subject }. Utile pour preview. */
  dry_run?: boolean;
  /**
   * Push manuel volontaire (clic user dans l'UI). Bypass uniquement le reject
   * `pending_bouncer` (deliverability_status NULL). Les autres protections (invalid,
   * role, suspicious_name) restent : Smartlead bannerait vite si on push des
   * emails confirmes morts.
   */
  manual_override?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get("origin")) });
  }

  let body: RequestBody = {};
  try {
    const rawText = await req.text();
    if (rawText && rawText.trim()) {
      body = JSON.parse(rawText) as RequestBody;
    }
  } catch {
    // empty
  }

  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  const _validation = validateOrRespond(SendViaSmartleadRequestSchema, body, corsHeaders, "strict", { functionName: "send-via-smartlead" });
  if (_validation.response) return _validation.response;
  const validated = _validation.data;
  body = validated as RequestBody;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { userId, error: authError } = await extractUserId(supabase, req, body.user_id);
  if (authError || !userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  // Admin check
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  if (!body.prospect_id) {
    return new Response(JSON.stringify({ error: "Missing prospect_id" }), {
      status: 400,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  const channel = body.channel || "email";
  if (channel !== "email") {
    return new Response(JSON.stringify({ error: `Channel not supported: ${channel}` }), {
      status: 400,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Fetch prospect profile
    const { data: prospect, error: pErr } = await supabase
      .from("prospect_profiles")
      .select(
        "id, first_name, last_name, email, job_title, company_name, linkedin_url, persona_id, workspace_id, enrichment_data, " +
        "email_source, email_validation_status, deliverability_status, deliverability_reason, company_group_id"
      )
      .eq("id", body.prospect_id)
      .single();
    if (pErr || !prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), {
        status: 404,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    if (!prospect.email) {
      return new Response(JSON.stringify({ error: "Prospect has no email" }), {
        status: 400,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    // === Email gate : refuse si bouncer dit invalide ou pattern faible ===
    const domain = prospect.email!.split("@")[1]?.toLowerCase() ?? "";
    const { data: pattern } = await supabase
      .from("domain_email_patterns")
      .select("pattern, confidence, tier, sample_count, empirical_sends, empirical_bounces, downgraded_at")
      .eq("domain", domain)
      .maybeSingle();

    const gateInput: GateInput = {
      email: prospect.email!,
      email_source: (prospect.email_source ?? "unknown") as GateInput["email_source"],
      email_validation_status: prospect.email_validation_status ?? null,
      deliverability_status: (prospect.deliverability_status ?? null) as GateInput["deliverability_status"],
      deliverability_reason: prospect.deliverability_reason ?? null,
      first_name: prospect.first_name ?? "",
      last_name: prospect.last_name ?? "",
      domain_pattern: pattern ? {
        pattern: pattern.pattern,
        confidence: Number(pattern.confidence),
        tier: pattern.tier as "high" | "medium" | "low" | "skip",
        sample_count: pattern.sample_count,
        empirical_sends: pattern.empirical_sends,
        empirical_bounces: pattern.empirical_bounces,
        downgraded_at: pattern.downgraded_at,
      } : null,
    };

    let decision = shouldPushToSmartlead(gateInput);

    // Push manuel : si l'user clic explicite et le seul blocage est
    // `pending_bouncer` (deliverability_status NULL = pas encore verifie), on autorise.
    // Les autres rejects restent (invalid email, role, suspicious_name) :
    // Smartlead bannerait vite si on push des emails confirmes morts.
    if (
      body.manual_override &&
      !decision.allow &&
      decision.reason === "pending_bouncer"
    ) {
      console.log(`[send-via-smartlead] manual override prospect=${body.prospect_id} bypass pending_bouncer`);
      decision = { allow: true, reason: "manual_override_pending_bouncer" };
    }

    await supabase.from("prospect_profiles").update({
      smartlead_push_decision: decision.allow ? "push" : decision.reason,
      smartlead_push_reason: decision.reason,
    }).eq("id", body.prospect_id);

    if (!decision.allow) {
      console.log(`[send-via-smartlead] gate refused prospect=${body.prospect_id} reason=${decision.reason}`);
      return new Response(JSON.stringify({
        error: "Email gate refused",
        reason: decision.reason,
        detail: decision.detail,
      }), {
        status: 422,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    // 2. Fetch draft message
    const { data: message, error: mErr } = await supabase
      .from("prospect_messages")
      .select("id, subject, body, status")
      .eq("prospect_id", body.prospect_id)
      .eq("channel", "email")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mErr || !message) {
      return new Response(JSON.stringify({ error: "No draft email message found" }), {
        status: 404,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    // 3. Resolve outreach provider actif (Phase 1.4 : abstraction Smartlead/autres)
    const resolved = await resolveOutreachProvider(supabase, prospect.workspace_id, channel);
    if (!resolved && !body.dry_run) {
      return new Response(JSON.stringify({
        error: `No active outreach provider configured for workspace/channel=${channel}. Configure workspace_outreach_providers.`,
      }), {
        status: 412,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    // Mode demo : on bloque les vrais envois Smartlead. Le caller voit que
    // l'action a "reussi" en mode demo (UI affiche un toast), mais aucun
    // email n'est envoye et rien n'est trace dans Smartlead.
    if (resolved?.provider?.type === 'demo') {
      console.log(`[send-via-smartlead] demo mode : faking send for prospect ${prospect.id}`);
      return new Response(JSON.stringify({
        ok: true,
        demo: true,
        message: "Envoi simule en mode demo. Configurez un provider Smartlead reel pour les vrais envois.",
      }), {
        status: 200,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    const enrichment = (prospect.enrichment_data as Record<string, unknown> | null) || {};

    // Resolve workspace_brand pour appliquer les attachments inline configures.
    interface BrandAttachment {
      persona_id?: string | null;
      channel?: string | null;
      type: "inline_image";
      url: string;
      alt?: string;
    }
    const { data: brand } = await supabase
      .from("workspace_brand")
      .select("attachments")
      .eq("workspace_id", prospect.workspace_id)
      .maybeSingle();
    const attachments = ((brand?.attachments as BrandAttachment[] | undefined) ?? []).filter(
      (a) =>
        a.type === "inline_image" &&
        (!a.persona_id || a.persona_id === prospect.persona_id) &&
        (!a.channel || a.channel === channel),
    );

    // Construit le body final :
    // - Texte brut converti en HTML (sauts de ligne => <br>)
    // - Append des attachments inline_image configures dans workspace_brand
    const textToHtml = (text: string) =>
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

    const bodyParagraphs = textToHtml(message.body);

    let attachmentsHtml = "";
    for (const a of attachments) {
      const altSafe = (a.alt ?? "").replace(/"/g, "&quot;");
      attachmentsHtml += `<br><br><img src="${a.url}" alt="${altSafe}" style="max-width:600px;width:100%;display:block;border-radius:8px;margin-top:12px;" />`;
    }

    const bodyHtml = bodyParagraphs + attachmentsHtml;

    // Dry-run : retourne le HTML rendu sans push (preview admin)
    if (body.dry_run) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          subject: message.subject || "",
          body_html: bodyHtml,
          email: prospect.email,
          provider_type: resolved?.provider.type ?? null,
        }),
        { status: 200, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
      );
    }

    // Defensive : non-dry-run, provider verifie plus haut
    if (!resolved) {
      return new Response(JSON.stringify({ error: "Provider not resolved" }), {
        status: 500,
        headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
      });
    }

    const outreachLead: OutreachLead = {
      prospect_id: prospect.id,
      workspace_id: prospect.workspace_id,
      persona_id: prospect.persona_id,
      email: prospect.email,
      first_name: prospect.first_name,
      last_name: prospect.last_name,
      company_name: prospect.company_name,
      job_title: prospect.job_title,
      linkedin_url: prospect.linkedin_url,
      body_html: bodyHtml,
      subject: message.subject || "",
      enrichment,
    };

    // 4. Push via le provider resolu (smartlead / microsoft_graph / resend / ...)
    const result = await resolved.provider.push(outreachLead, resolved.context, supabase);

    // 5. Update message status + log action
    await supabase
      .from("prospect_messages")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", message.id);

    // Track l'action "sent/email" pour que useCompanyProgress remonte le %
    // company_group_id est requis (cle de jointure dans le hook progress)
    const { error: actionErr } = await supabase
      .from("prospect_actions")
      .insert({
        prospect_id: prospect.id,
        workspace_id: prospect.workspace_id,
        company_group_id: prospect.company_group_id,
        action_type: "sent",
        channel: "email",
      });
    if (actionErr) {
      // Pas bloquant pour le push mais on logge pour ne plus jamais avoir
      // des % a 0 alors que tout est parti (bug du 2026-05-18).
      console.warn(`[send-via-smartlead] Failed to log prospect_action for ${prospect.id}: ${actionErr.message}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        provider_type: resolved.provider.type,
        provider_ref: result.provider_ref ?? null,
        added: result.added,
        skipped: result.skipped,
        lead_email: prospect.email,
        meta: result.meta ?? {},
      }),
      { status: 200, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    // Erreurs de configuration actionnables par l'utilisateur (campagne non reliée /
    // persona absent) -> 412, pas 500 : ce n'est pas un crash. Le front affiche le message.
    const isConfigError = /campagne smartlead|persona/i.test(msg);
    if (!isConfigError) console.error("[send-via-smartlead] Error:", err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: isConfigError ? 412 : 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
    );
  }
});

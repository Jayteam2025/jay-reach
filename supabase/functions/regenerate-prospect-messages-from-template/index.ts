import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";
import {
  type EnrichmentForRender,
  type MessageTemplate,
  type RenderContext,
  renderTemplate,
} from "../_shared/prospect-renderer.ts";
import { type PersonaConfig } from "../_shared/workspace-config.ts";

/**
 * regenerate-prospect-messages-from-template
 *
 * Admin-only. Re-render tous les prospect_messages "non envoyes" qui
 * correspondent au couple (target_category, channel) du template fourni.
 *
 * "Non envoye" = status NOT IN ('sent', 'replied', 'bounced').
 * Couvre uniformement email (Smartlead), linkedin (extension), postal_letter.
 *
 * Auth : JWT + isInternalEmail(jwt.email).
 *
 * Input : { template_id: uuid }
 * Output : { regenerated_count, template_version, skipped }
 */

const RegenerateProspectsRequestSchema = z.object({
  template_id: z.string().uuid(),
}).passthrough();

interface RequestBody {
  template_id?: string;
}

interface DbTemplate extends MessageTemplate {
  id: string;
  version: number;
  is_active: boolean;
}

interface ProspectRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string;
  company_sector: string | null;
  target_category: "hr" | "director" | "field_sales";
  persona_id: string | null;
  source_signal_id: string | null;
  enrichment_data: Record<string, unknown> | null;
}

interface MessageRow {
  id: string;
  prospect_id: string;
  channel: string;
  status: string;
}

const CHUNK_SIZE = 50;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      token,
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OSS : l'opérateur est admin de son propre workspace (plus de gate Jay-staff
    // isInternalEmail). On exige juste d'être owner/admin d'un workspace.
    const { data: adminMembership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    if (!adminMembership) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin only" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Body
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const _validation = validateOrRespond(
      RegenerateProspectsRequestSchema,
      body,
      corsHeaders,
      "strict",
      { functionName: "regenerate-prospect-messages-from-template" }
    );
    if (_validation.response) return _validation.response;

    // Charge le template
    const { data: template, error: tplErr } = await supabase
      .from("prospect_message_templates")
      .select(
        "id, target_category, persona_id, workspace_id, channel, subject, body, icebreaker_template, version, is_active",
      )
      .eq("id", body.template_id)
      .maybeSingle();

    if (tplErr) throw tplErr;
    if (!template) {
      return new Response(JSON.stringify({ error: "Template not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t = template as DbTemplate;

    // Load persona pour ce template (fallback label depuis persona ou null)
    let personaLabel: string | null = null;
    if (t.persona_id) {
      const { data: personaRow } = await supabase
        .from("icp_personas")
        .select("label")
        .eq("id", t.persona_id)
        .maybeSingle();
      if (personaRow && "label" in personaRow) {
        personaLabel = (personaRow.label as string) ?? null;
      }
    }

    console.log(
      `[regenerate] start template=${t.id} ${t.target_category || "no-category"}:${t.channel} v${t.version}`,
    );

    // Charge tous les messages candidats (non envoyes)
    const { data: messages, error: msgErr } = await supabase
      .from("prospect_messages")
      .select("id, prospect_id, channel, status")
      .eq("channel", t.channel)
      .not("status", "in", "(sent,replied,bounced)");

    if (msgErr) throw msgErr;
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({
          regenerated_count: 0,
          template_version: t.version,
          skipped: 0,
          note: "no candidate messages",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Charge les profils par chunks pour eviter URLs > 16K chars (limite PostgREST)
    const prospectIds = Array.from(
      new Set((messages as MessageRow[]).map((m) => m.prospect_id)),
    );
    // Jay Reach PR4 : filtre par persona_id uniquement (template doit avoir persona_id).
    const SELECT_CHUNK = 100;
    const templatePersonaId =
      (t as DbTemplate & { persona_id?: string | null }).persona_id ?? null;
    if (!templatePersonaId) {
      return new Response(
        JSON.stringify({
          error: "Template missing persona_id — this operation requires persona-based templates",
          regenerated_count: 0,
          template_version: t.version,
          skipped: 0,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const prospectById = new Map<string, ProspectRow>();
    for (let i = 0; i < prospectIds.length; i += SELECT_CHUNK) {
      const chunkIds = prospectIds.slice(i, i + SELECT_CHUNK);
      const chunkQuery = supabase
        .from("prospect_profiles")
        .select(
          "id, first_name, last_name, job_title, company_name, company_sector, target_category, persona_id, source_signal_id, enrichment_data",
        )
        .in("id", chunkIds)
        .is("deleted_at", null)
        .eq("persona_id", templatePersonaId);

      const { data: prospects, error: prospectErr } = await chunkQuery;
      if (prospectErr) throw prospectErr;
      for (const p of (prospects || []) as ProspectRow[]) {
        prospectById.set(p.id, p);
      }
    }

    // Charge les signaux associes par chunks
    const signalIds = Array.from(
      new Set(
        Array.from(prospectById.values())
          .map((p) => p.source_signal_id)
          .filter((id): id is string => !!id),
      ),
    );
    const signalById = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < signalIds.length; i += SELECT_CHUNK) {
      const chunkIds = signalIds.slice(i, i + SELECT_CHUNK);
      const { data: signals } = await supabase
        .from("prospect_signals")
        .select("id, raw_content, extracted_data")
        .in("id", chunkIds);
      for (const s of signals || []) {
        signalById.set(s.id as string, s as Record<string, unknown>);
      }
    }

    // Load brand pour le workspace du template (substitution {brand_signature}, {brand_name})
    const templateWorkspaceId = (t as DbTemplate & { workspace_id?: string | null }).workspace_id ?? null;
    let brand: { brand_name: string | null; signature: string | null } | null = null;
    if (templateWorkspaceId) {
      const { data: brandRow } = await supabase
        .from("workspace_brand")
        .select("brand_name, signature")
        .eq("workspace_id", templateWorkspaceId)
        .maybeSingle();
      brand = brandRow ?? null;
    }

    // Render + update par chunks
    let regenerated = 0;
    let skipped = 0;
    const updates: Array<{
      id: string;
      subject: string | null;
      body: string;
      icebreaker: string;
    }> = [];

    for (const m of messages as MessageRow[]) {
      const profile = prospectById.get(m.prospect_id);
      if (!profile) {
        skipped++;
        continue;
      }

      if (!profile.first_name || !profile.first_name.trim()) {
        skipped++;
        continue;
      }

      const signal = profile.source_signal_id
        ? signalById.get(profile.source_signal_id)
        : null;
      const enrichment =
        (profile.enrichment_data as Record<string, unknown> | null) || {};
      const linkedinSnapshot =
        (enrichment.linkedin as Record<string, unknown> | undefined) || null;
      const companyNews = (enrichment.company_news as string) || "";
      const postalAddress =
        (enrichment.company_address as string | undefined) || null;

      const ctx: RenderContext = {
        profile: {
          id: profile.id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          job_title: profile.job_title,
          company_name: profile.company_name,
          company_sector: profile.company_sector,
          target_category: profile.target_category,
          persona_id: profile.persona_id ?? null,
        },
        signal: signal
          ? {
            raw_content: (signal.raw_content as string | null) ?? null,
            extracted_data:
              (signal.extracted_data as Record<string, unknown> | null) ??
                null,
          }
          : null,
        enrichment: {
          linkedin: linkedinSnapshot as EnrichmentForRender["linkedin"],
          company_news: companyNews || null,
          company_address: postalAddress,
        },
        brand,
        personaLabel,
      };

      const rendered = renderTemplate(t, ctx);
      updates.push({
        id: m.id,
        subject: rendered.subject || null,
        body: rendered.body,
        icebreaker: rendered.icebreaker,
      });
    }

    // Updates par chunks (sequentiel pour eviter de surcharger PG)
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map((u) =>
          supabase
            .from("prospect_messages")
            .update({
              subject: u.subject,
              body: u.body,
              icebreaker: u.icebreaker,
              template_id: t.id,
              template_version: t.version,
              llm_model: "template-v1",
              updated_at: new Date().toISOString(),
            })
            .eq("id", u.id)
        ),
      );
      regenerated += chunk.length;
    }

    console.log(
      `[regenerate] done template=${t.id} v${t.version} regenerated=${regenerated} skipped=${skipped}`,
    );

    return new Response(
      JSON.stringify({
        regenerated_count: regenerated,
        template_version: t.version,
        skipped,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    let msg: string;
    if (err instanceof Error) {
      msg = err.message;
    } else if (err && typeof err === "object") {
      const e = err as {
        message?: string;
        details?: string;
        hint?: string;
        code?: string;
      };
      msg =
        `${e.code || ""} ${e.message || ""} ${e.details || ""} ${e.hint || ""}`
          .trim() || JSON.stringify(err);
    } else {
      msg = String(err);
    }
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[regenerate] Error:", msg, JSON.stringify(err), stack);
    return new Response(
      JSON.stringify({ error: msg, stack: stack?.slice(0, 600) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

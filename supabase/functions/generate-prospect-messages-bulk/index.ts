import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import {
  type EnrichmentForRender,
  type MessageTemplate,
  type RenderContext,
  renderDeterministic,
} from "../_shared/prospect-renderer.ts";
import { loadActivePersonas, type PersonaConfig, WorkspaceConfigError } from "../_shared/workspace-config.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

/**
 * generate-prospect-messages-bulk
 *
 * Genere les messages multi-canaux pour tous les profils d'un groupe
 * d'entreprise (ou d'une liste de profils) via le renderer deterministe
 * pilote par la table `prospect_message_templates`.
 *
 * Canaux couverts :
 * - RH → email + linkedin (+ CV PJ pour email)
 * - Dir Co → email + linkedin + postal_letter (lettre manuscrite Manuscry)
 * - Commercial terrain → email + linkedin
 *
 * Le mode "submit-batch" est conserve pour compat API frontend, mais il
 * n'envoie plus de batch Anthropic — tous les messages sont rendus en
 * synchronously et inseres dans `prospect_messages` (status=draft).
 */

interface RequestBody {
  mode?: "submit-batch" | "check-batch";
  company_group_id?: string;
  profile_ids?: string[];
  batch_id?: string;
  user_id?: string;
}

const GenerateProspectMessagesBulkRequestSchema = z.object({
  mode: z.enum(["submit-batch", "check-batch"]).optional(),
  company_group_id: z.string().uuid().optional(),
  profile_ids: z.array(z.string().uuid()).optional(),
  batch_id: z.string().optional(),
  user_id: z.string().uuid().optional(),
}).passthrough();

interface ProspectProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  job_title: string | null;
  company_name: string;
  company_sector: string | null;
  target_category: "hr" | "director" | "field_sales";
  /** FK vers icp_personas (Jay Reach 1.2.2+). Null pour rows pre-migration. */
  persona_id: string | null;
  workspace_id: string;
  linkedin_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  source_signal_id: string | null;
  enrichment_data: Record<string, unknown> | null;
  company_group_id: string;
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: getCorsHeaders(req.headers.get("origin")),
    });
  }

  let body: RequestBody = {};
  try {
    const rawText = await req.text();
    if (rawText && rawText.trim()) {
      body = JSON.parse(rawText) as RequestBody;
    }
  } catch {
    // body may be empty or invalid JSON
  }

  const _validation = validateOrRespond(GenerateProspectMessagesBulkRequestSchema, body, getCorsHeaders(req.headers.get("origin")), "strict", { functionName: "generate-prospect-messages-bulk" });
  if (_validation.response) return _validation.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { userId, error: authError } = await extractUserId(
    supabase,
    req,
    body.user_id,
  );
  if (authError || !userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        ...getCorsHeaders(req.headers.get("origin")),
        "Content-Type": "application/json",
      },
    });
  }

  const mode = body.mode || "submit-batch";

  try {
    // ============================================================
    // check-batch : compat legacy (plus de batch Anthropic).
    // Reponse synchrone done=true pour ne pas casser les pollers existants.
    // ============================================================
    if (mode === "check-batch") {
      return new Response(
        JSON.stringify({
          batch_id: body.batch_id || null,
          done: true,
          inserted: 0,
          failed: 0,
          total: 0,
          note: "deterministic-only — no batch to poll",
        }),
        {
          status: 200,
          headers: {
            ...getCorsHeaders(req.headers.get("origin")),
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (mode !== "submit-batch") {
      return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), {
        status: 400,
        headers: {
          ...getCorsHeaders(req.headers.get("origin")),
          "Content-Type": "application/json",
        },
      });
    }

    // ============================================================
    // submit-batch
    // ============================================================
    let query = supabase
      .from("prospect_profiles")
      .select(
        "id, first_name, last_name, email, job_title, company_name, company_sector, target_category, persona_id, workspace_id, linkedin_url, instagram_url, tiktok_url, source_signal_id, enrichment_data, company_group_id",
      );

    if (body.company_group_id) {
      query = query.eq("company_group_id", body.company_group_id);
    } else if (body.profile_ids && body.profile_ids.length > 0) {
      query = query.in("id", body.profile_ids);
    } else {
      return new Response(
        JSON.stringify({ error: "Missing company_group_id or profile_ids" }),
        {
          status: 400,
          headers: {
            ...getCorsHeaders(req.headers.get("origin")),
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { data: profiles, error: profErr } = await query;
    if (profErr) throw profErr;
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ error: "No profiles found" }), {
        status: 404,
        headers: {
          ...getCorsHeaders(req.headers.get("origin")),
          "Content-Type": "application/json",
        },
      });
    }

    // Fetch templates (source: prospect_message_templates, edite via UI Config)
    const { data: templates, error: tplErr } = await supabase
      .from("prospect_message_templates")
      .select(
        "id, target_category, persona_id, channel, subject, body, icebreaker_template, version",
      )
      .eq("is_active", true);
    if (tplErr) throw tplErr;
    if (!templates || templates.length === 0) {
      return new Response(JSON.stringify({ error: "No templates found" }), {
        status: 404,
        headers: {
          ...getCorsHeaders(req.headers.get("origin")),
          "Content-Type": "application/json",
        },
      });
    }

    // Jay Reach PR4 : indexe les templates par persona_id UNIQUEMENT.
    // Match strict persona_id + channel.
    type TemplateRow = MessageTemplate & {
      id: string;
      version: number;
      persona_id: string | null;
    };
    const tplByPersonaChannel = new Map<string, TemplateRow>();
    for (const t of templates as TemplateRow[]) {
      if (t.persona_id) {
        tplByPersonaChannel.set(`${t.persona_id}:${t.channel}`, t);
      }
    }

    function findTemplate(
      personaId: string | null | undefined,
      channel: string,
    ): TemplateRow | undefined {
      if (!personaId) return undefined;
      return tplByPersonaChannel.get(`${personaId}:${channel}`);
    }

    // Pre-load workspace_brand et personas actifs pour tous les workspaces presents dans la batch
    const workspaceIds = Array.from(
      new Set((profiles as ProspectProfile[]).map((p) => p.workspace_id).filter((id): id is string => !!id)),
    );
    interface BrandRow { workspace_id: string; brand_name: string | null; signature: string | null }
    const brandByWorkspace = new Map<string, BrandRow>();
    if (workspaceIds.length > 0) {
      const { data: brands } = await supabase
        .from("workspace_brand")
        .select("workspace_id, brand_name, signature")
        .in("workspace_id", workspaceIds);
      for (const b of (brands || []) as BrandRow[]) {
        brandByWorkspace.set(b.workspace_id, b);
      }
    }

    // Load personas actifs pour chaque workspace (fail-fast si absent)
    const personaByWorkspace = new Map<string, Map<string, PersonaConfig>>();
    for (const wsId of workspaceIds) {
      try {
        const personas = await loadActivePersonas(supabase, wsId);
        const personaMap = new Map<string, PersonaConfig>();
        for (const p of personas) {
          personaMap.set(p.id, p);
        }
        personaByWorkspace.set(wsId, personaMap);
      } catch (err) {
        if (err instanceof WorkspaceConfigError) {
          console.error(`[generate-prospect-messages-bulk] Workspace ${wsId} config error: ${err.code} — ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    const signalIds = Array.from(
      new Set(
        (profiles as ProspectProfile[])
          .map((p) => p.source_signal_id)
          .filter((id): id is string => !!id),
      ),
    );
    const signalById = new Map<string, Record<string, unknown>>();
    if (signalIds.length > 0) {
      const { data: signals } = await supabase
        .from("prospect_signals")
        .select("id, raw_content, extracted_data")
        .in("id", signalIds);
      for (const s of (signals || [])) {
        signalById.set(s.id as string, s as Record<string, unknown>);
      }
    }

    const deterministicMessagesToInsert: Record<string, unknown>[] = [];
    let skipped = 0;
    let skippedNoChannelData = 0;
    let skippedNoPersona = 0;

    for (const p of profiles as ProspectProfile[]) {
      // Résoudre le persona pour ce profil
      if (!p.persona_id) {
        console.log(`[generate-prospect-messages-bulk] SKIP no persona_id: ${p.first_name} ${p.last_name} @ ${p.company_name}`);
        skippedNoPersona++;
        continue;
      }

      const personasForWs = personaByWorkspace.get(p.workspace_id);
      if (!personasForWs) {
        // Workspace pas chargé (erreur lors du load) — skip le profil
        console.log(`[generate-prospect-messages-bulk] SKIP workspace config missing: ${p.workspace_id}`);
        skippedNoPersona++;
        continue;
      }

      const persona = personasForWs.get(p.persona_id);
      if (!persona) {
        console.log(`[generate-prospect-messages-bulk] SKIP persona not found: persona_id=${p.persona_id}`);
        skippedNoPersona++;
        continue;
      }

      const channels = persona.channels_priority || [];
      if (channels.length === 0) {
        console.log(`[generate-prospect-messages-bulk] SKIP persona no channels: persona_id=${p.persona_id}`);
        skippedNoPersona++;
        continue;
      }

      const signal = p.source_signal_id
        ? signalById.get(p.source_signal_id)
        : null;
      const enrichment =
        (p.enrichment_data as Record<string, unknown> | null) || {};
      const linkedinSnapshot =
        (enrichment.linkedin as Record<string, unknown> | undefined) || null;
      const companyNews = (enrichment.company_news as string) || "";
      const postalAddress =
        (enrichment.company_address as string | undefined) || null;

      for (const channel of channels) {
        if (channel === "email" && !p.email) {
          console.log(
            `[generate-prospect-messages-bulk] SKIP email (no email): ${p.first_name} ${p.last_name} @ ${p.company_name}`,
          );
          skippedNoChannelData++;
          continue;
        }
        if (channel === "social_dm" && !p.instagram_url && !p.tiktok_url) {
          skippedNoChannelData++;
          continue;
        }
        if (channel === "postal_letter" && !postalAddress) {
          console.log(
            `[generate-prospect-messages-bulk] SKIP postal_letter (no address): ${p.first_name} ${p.last_name} @ ${p.company_name}`,
          );
          skippedNoChannelData++;
          continue;
        }
        if (channel === "linkedin" && !p.linkedin_url) {
          console.log(
            `[generate-prospect-messages-bulk] SKIP linkedin (no linkedin_url): ${p.first_name} ${p.last_name} @ ${p.company_name}`,
          );
          skippedNoChannelData++;
          continue;
        }

        const template = findTemplate(p.persona_id, channel);
        if (!template) {
          skipped++;
          continue;
        }

        if (!p.first_name || !p.first_name.trim()) {
          console.log(
            `[generate-prospect-messages-bulk] SKIP deterministic (no first_name): ${p.last_name} @ ${p.company_name}`,
          );
          skippedNoChannelData++;
          continue;
        }

        const brand = brandByWorkspace.get(p.workspace_id);
        const renderCtx: RenderContext = {
          profile: {
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            job_title: p.job_title,
            company_name: p.company_name,
            company_sector: p.company_sector,
            target_category: p.target_category as
              | "hr"
              | "director"
              | "field_sales",
            persona_id: p.persona_id,
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
          brand: brand ? { signature: brand.signature, brand_name: brand.brand_name } : null,
          personaLabel: persona?.label || null,
        };
        const rendered = renderDeterministic(renderCtx, channel, template);
        if (!rendered) {
          skipped++;
          continue;
        }
        deterministicMessagesToInsert.push({
          prospect_id: p.id,
          workspace_id: p.workspace_id,
          persona_id: p.persona_id,
          channel,
          subject: rendered.subject || null,
          body: rendered.body,
          icebreaker: rendered.icebreaker || null,
          status: "draft",
          llm_model: "template-v1",
          template_id: template.id,
          template_version: template.version,
        });
      }
    }

    let instantInserted = 0;
    if (deterministicMessagesToInsert.length > 0) {
      // Dedup drafts existants pour eviter les doublons (re-run du meme batch)
      for (const m of deterministicMessagesToInsert) {
        await supabase
          .from("prospect_messages")
          .delete()
          .eq("prospect_id", m.prospect_id)
          .eq("channel", m.channel)
          .eq("status", "draft");
      }
      const { error: detInsertErr } = await supabase
        .from("prospect_messages")
        .insert(deterministicMessagesToInsert);
      if (detInsertErr) {
        console.error(
          `[generate-prospect-messages-bulk] insert failed: ${detInsertErr.message}`,
        );
        throw detInsertErr;
      }
      instantInserted = deterministicMessagesToInsert.length;
      console.log(
        `[generate-prospect-messages-bulk] inserted ${instantInserted}`,
      );
    }

    return new Response(
      JSON.stringify({
        message: instantInserted > 0
          ? "Deterministic messages inserted"
          : "No messages to generate",
        total: instantInserted,
        instant_inserted: instantInserted,
        profiles: profiles.length,
        skipped,
        skipped_no_channel_data: skippedNoChannelData,
        skipped_no_persona: skippedNoPersona,
      }),
      {
        status: 200,
        headers: {
          ...getCorsHeaders(req.headers.get("origin")),
          "Content-Type": "application/json",
        },
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
    console.error("[generate-prospect-messages-bulk] Error:", msg, err, stack);
    return new Response(
      JSON.stringify({ error: msg, stack: stack?.slice(0, 600) }),
      {
        status: 500,
        headers: {
          ...getCorsHeaders(req.headers.get("origin")),
          "Content-Type": "application/json",
        },
      },
    );
  }
});

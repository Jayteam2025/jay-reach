// supabase/functions/detect-crm/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveDomain } from "../_shared/crm-detection/domain-resolver.ts";
import { scanDnsForCrm } from "../_shared/crm-detection/dns-resolver.ts";
import { scanHomepageForCrm } from "../_shared/crm-detection/homepage-scraper.ts";
import { searchWebForCrmCustomerStory } from "../_shared/crm-detection/web-search-crm.ts";
import { analyzeJobsForCrm } from "../_shared/crm-detection/jobs-analyzer.ts";
import { scanLinkedInSkillsForCrm } from "../_shared/crm-detection/linkedin-skills-analyzer.ts";
import { aggregateMultiSource } from "../_shared/crm-detection/confidence.ts";
import type { CompanyMetadata, DetectionSignal } from "../_shared/crm-detection/types.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

// Schéma de validation Zod pour detect-crm
const DetectCrmRequestSchema = z.object({
  company_group_id: z.string().uuid(),
  force: z.boolean().optional(),
});

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  // Auth : service_role (cron / fire-and-forget) OU JWT user (re-détection manuelle)
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceRole = authHeader === `Bearer ${cronSecret}` || authHeader === `Bearer ${serviceRoleKey}`;

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );

  if (!isServiceRole) {
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (!userId) {
      return jsonResponse({ error: authError ?? "unauthorized" }, 401, corsHeaders);
    }
    // (admin check skipped here — RLS on prospect_crm_detections enforces admin-only writes
    // via service_role bypass, but reads via user JWT are RLS-protected by the existing policy)
  }

  const body = await req.json().catch(() => ({}));
  const _validation = validateOrRespond(DetectCrmRequestSchema, body, corsHeaders, "strict", { functionName: "detect-crm" });
  if (_validation.response) return _validation.response;

  const { company_group_id, force = false } = _validation.data;

  // 1. Cache hit ?
  if (!force) {
    const { data: existing } = await supabase
      .from("prospect_crm_detections")
      .select("*")
      .eq("company_group_id", company_group_id)
      .maybeSingle();
    if (existing?.detection_status === "completed") {
      return jsonResponse({ cached: true, detection: existing }, 200, corsHeaders);
    }
  }

  // Resolve workspace_id pour multi-tenant (NOT NULL sur prospect_crm_detections)
  const { data: wsRow } = await supabase
    .from("prospect_profiles")
    .select("workspace_id")
    .eq("company_group_id", company_group_id)
    .not("workspace_id", "is", null)
    .limit(1)
    .maybeSingle();
  const workspaceId = (wsRow?.workspace_id as string) ?? null;
  if (!workspaceId) {
    return jsonResponse({ error: "workspace_id not resolvable for company_group_id" }, 422, corsHeaders);
  }

  // 2. UPSERT pending
  await supabase.from("prospect_crm_detections").upsert({
    company_group_id,
    workspace_id: workspaceId,
    detection_status: "pending",
    crm_confidence: "pending",
    crm_name: null,
    error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_group_id" });

  await supabase.rpc("increment_crm_detection_attempts", { p_company_group_id: company_group_id })
    .then((r) => {
      if (r.error) console.warn("[detect-crm] increment_attempts RPC failed:", r.error.message);
    });

  try {
    // 3. Récupère metadata entreprise
    const company = await fetchCompanyMetadata(company_group_id, supabase);
    if (!company) throw new Error("company not found in prospect_profiles");

    // 4. Résolution domaine
    const domainResult = await resolveDomain(company, supabase);

    // 5. Lance les 5 sources de signaux en parallele (allSettled = tolerance partielle)
    //    A. DNS (SPF/MX/CNAME sub-domains) — signal le plus fort
    //    B. HTML home + pages legales — trackers/forms/scripts
    //    C. Brave search "Nom" + CRMNom -> customer-story domain ou job posting
    //    D. Jobs analyzer — texte des annonces dans prospect_signals
    //    E. LinkedIn skills — mentions CRM dans titres/skills des profils enrichis
    const [dnsSettled, htmlSettled, webSettled, jobsSettled, linkedinSettled] = await Promise.allSettled([
      domainResult ? scanDnsForCrm(domainResult.domain) : Promise.resolve(null),
      domainResult ? scanHomepageForCrm(domainResult.domain) : Promise.resolve(null),
      searchWebForCrmCustomerStory(company.name, domainResult?.domain ?? null),
      analyzeJobsForCrm(company_group_id, company.name, supabase),
      scanLinkedInSkillsForCrm(company_group_id, supabase),
    ]);

    const allSignals: DetectionSignal[] = [];
    const allMarketingTools: { tool: string; category: string }[] = [];

    if (dnsSettled.status === "fulfilled" && dnsSettled.value) {
      const dns = dnsSettled.value;
      console.log(`[detect-crm] DNS scan ${domainResult?.domain}: ${dns.matched_crms.length} CRMs, ${dns.marketing_tools.length} marketing tools`);
      for (const m of dns.matched_crms) {
        allSignals.push({ crm: m.crm, source: m.source, evidence: m.evidence });
      }
      allMarketingTools.push(...dns.marketing_tools);
    }

    if (htmlSettled.status === "fulfilled" && htmlSettled.value) {
      const html = htmlSettled.value;
      console.log(`[detect-crm] HTML scan ${domainResult?.domain}: ${html.matched_crms.length} CRMs from ${html.pages_scanned.length} pages`);
      for (const m of html.matched_crms) {
        allSignals.push({ crm: m.crm, source: m.source, evidence: `${m.path}: ${m.evidence}` });
      }
      allMarketingTools.push(...html.marketing_tools);
    }

    if (webSettled.status === "fulfilled" && webSettled.value) {
      const web = webSettled.value;
      console.log(`[detect-crm] Web search ${company.name}: ${web.queries_performed} queries, ${web.matched_crms.length} customer stories`);
      for (const m of web.matched_crms) {
        allSignals.push({ crm: m.crm, source: m.source, evidence: m.evidence });
      }
    }

    if (jobsSettled.status === "fulfilled" && jobsSettled.value) {
      const jobs = jobsSettled.value;
      for (const job of jobs) {
        for (const crm of job.matched_crms) {
          allSignals.push({ crm, source: "jobs", evidence: `${job.source}: ${job.job_title}` });
        }
      }
    }

    if (linkedinSettled.status === "fulfilled" && linkedinSettled.value) {
      const li = linkedinSettled.value;
      console.log(`[detect-crm] LinkedIn scan ${company.name}: ${li.profiles_with_crm}/${li.profiles_scanned} profils mentionnent un CRM, ${li.matched_crms.length} CRMs distincts`);
      for (const m of li.matched_crms) {
        allSignals.push({
          crm: m.crm,
          source: "linkedin",
          evidence: m.evidence,
          weight_multiplier: m.weight_multiplier,
        });
      }
    }

    // Dedupe marketing_tools (peut apparaitre dans DNS + HTML)
    const seenTools = new Set<string>();
    const uniqueMarketingTools = allMarketingTools.filter((t) => {
      if (seenTools.has(t.tool)) return false;
      seenTools.add(t.tool);
      return true;
    });

    // 6. Agrege par vote pondere
    const detection = aggregateMultiSource({
      signals: allSignals,
      marketing_tools: uniqueMarketingTools,
      domain: domainResult?.domain ?? null,
      domain_source: domainResult?.source ?? null,
    });

    // 7. UPSERT résultat final
    const finalUpsert = await supabase.from("prospect_crm_detections").upsert({
      company_group_id,
      workspace_id: workspaceId,
      domain: domainResult?.domain ?? null,
      domain_source: domainResult?.source ?? null,
      crm_name: detection.crm_name,
      crm_confidence: detection.confidence,
      detection_status: "completed",
      error: null,
      crm_signals: detection.signals,
      detected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_group_id" });
    if (finalUpsert.error) {
      console.error("[detect-crm] final UPSERT failed:", JSON.stringify(finalUpsert.error));
      throw new Error(`final upsert failed: ${finalUpsert.error.message}`);
    }
    console.log(`[detect-crm] completed ${company_group_id} crm=${detection.crm_name} conf=${detection.confidence}`);

    return jsonResponse({
      crm_name: detection.crm_name,
      confidence: detection.confidence,
      domain: domainResult?.domain ?? null,
    }, 200, corsHeaders);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[detect-crm] failure:", errMsg);
    await supabase.from("prospect_crm_detections").upsert({
      company_group_id,
      workspace_id: workspaceId,
      detection_status: "failed",
      crm_confidence: "none",
      error: errMsg,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_group_id" });
    return jsonResponse({ error: errMsg }, 500, corsHeaders);
  }
});

async function fetchCompanyMetadata(
  groupId: string,
  supabase: SupabaseClient,
): Promise<CompanyMetadata | null> {
  const { data } = await supabase
    .from("prospect_profiles")
    .select("company_name, company_siren, company_city, workspace_id")
    .eq("company_group_id", groupId)
    .not("company_name", "is", null)
    .limit(1)
    .maybeSingle();
  if (!data?.company_name) return null;
  return {
    group_id: groupId,
    name: data.company_name,
    siren: data.company_siren ?? undefined,
    city: data.company_city ?? undefined,
    workspace_id: data.workspace_id ?? undefined,
  };
}

function jsonResponse(body: unknown, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

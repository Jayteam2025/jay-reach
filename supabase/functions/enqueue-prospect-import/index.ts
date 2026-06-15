import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveUserWorkspace } from "../_shared/workspace.ts";
import { checkRateLimit } from "../_shared/rate-limiter.ts";
import { validateOrRespond } from "../_shared/validation.ts";
import {
  EnqueueImportRequestSchema,
  type PreviewRow,
} from "../_shared/schemas/prospect-import.ts";
import { detectDoNotOutreachReasons, isInvalidLinkedinUrl, normalizeLinkedinUrl } from "../_shared/linkedin-validator.ts";

/**
 * enqueue-prospect-import
 *
 * Commit l'import :
 *   1. Cree 1 row prospect_imports (audit)
 *   2. Insere ou update N rows prospect_signals (acquisition_method='file_upload')
 *   3. Applique smart-skip pour les contacts deja engages (do_not_outreach_reasons)
 *   4. Declenche le pipeline d'enrichissement standard via enqueue-enrichment
 *   5. Log dans prospect_data_access_logs
 *
 * Pour V1 : pas d'atomicite stricte (volume admin faible, retry manuel OK
 * en cas de crash partiel). Les writes sont sequentiels, pas dans une
 * transaction Postgres. Si l'admin voit un etat partiel, il peut relancer.
 *
 * Spec : docs/superpowers/specs/2026-05-12-prospection-file-upload-import-design.md
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ─── Helpers ──────────────────────────────────────────

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-zàâäéèêëïîôùûüÿçœæ0-9\s]/g, "")
    .replace(/\b(sa|sas|sca|sarl|eurl|group|groupe|france|international|distribution)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickCompanyName(row: PreviewRow): string {
  return (row.raison_sociale || "").trim();
}

function buildExtractedData(row: PreviewRow): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.contact_first_name) data.contact_first_name = row.contact_first_name;
  if (row.contact_last_name) data.contact_last_name = row.contact_last_name;
  if (row.contact_role) data.contact_role = row.contact_role;
  if (row.contact_email) data.contact_email = row.contact_email;
  if (row.contact_phone) data.contact_phone = row.contact_phone;
  if (row.linkedin_url) {
    const normalized = normalizeLinkedinUrl(row.linkedin_url);
    if (normalized) data.linkedin_url = normalized;
  }
  if (row.address) data.address = row.address;
  if (row.city) data.city = row.city;
  if (row.country) data.country = row.country;
  if (row.domain) data.domain = row.domain;
  if (row.sector) data.sector = row.sector;
  if (row.siren) data.siren = row.siren;
  return data;
}

function buildImportedMetadata(row: PreviewRow): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (row.tier) meta.tier = row.tier;
  if (row.angle) meta.angle = row.angle;
  if (row.notes) meta.notes = row.notes;
  if (row.pipeline_status) meta.pipeline_status = row.pipeline_status;
  if (row.ca_estimate) meta.ca_estimate = row.ca_estimate;
  if (row.fdv_size) meta.fdv_size = row.fdv_size;
  if (row.imported_metadata && typeof row.imported_metadata === "object") {
    // Filtre __proto__ / constructor / prototype pour anti-pollution
    for (const [k, v] of Object.entries(row.imported_metadata)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      meta[k] = v;
    }
  }
  return meta;
}

interface MatchResult {
  signal_id: string | null;
  was_existing_acquisition_method: string | null;
}

async function findExistingSignal(rawName: string): Promise<MatchResult> {
  const normalized = normalizeCompanyName(rawName);
  if (!normalized) return { signal_id: null, was_existing_acquisition_method: null };

  // Recherche fuzzy via pg_trgm similarity (>= 0.85 = très proche, tolère
  // les SA/SAS/Groupe différents)
  const { data, error } = await supabase
    .from("prospect_signals")
    .select("id, acquisition_method, company_name")
    .ilike("company_name", `%${normalized.split(" ")[0] || normalized}%`)
    .limit(20);

  if (error || !data || data.length === 0) {
    return { signal_id: null, was_existing_acquisition_method: null };
  }

  // Filtre côté Deno avec similarity simple
  for (const row of data) {
    if (!row.company_name) continue;
    const candidate = normalizeCompanyName(row.company_name);
    if (candidate === normalized) {
      return {
        signal_id: row.id,
        was_existing_acquisition_method: row.acquisition_method,
      };
    }
  }

  return { signal_id: null, was_existing_acquisition_method: null };
}

function json(body: unknown, status: number, corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function triggerEnrichmentJob(
  signalIds: string[],
  authHeader: string,
  corsOrigin: string | null
): Promise<string | null> {
  if (signalIds.length === 0) return null;

  const url = `${supabaseUrl}/functions/v1/enqueue-enrichment`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        ...(corsOrigin ? { Origin: corsOrigin } : {}),
      },
      body: JSON.stringify({ signal_ids: signalIds, concurrency: 5 }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("[ENQUEUE-IMPORT] enqueue-enrichment failed:", response.status, txt.slice(0, 200));
      return null;
    }

    const data = await response.json().catch(() => ({}));
    return (data?.job_id as string) || null;
  } catch (err) {
    console.error("[ENQUEUE-IMPORT] Failed to trigger enqueue-enrichment:", err);
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    // 1. Auth
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) return json({ error: "Unauthorized" }, 401, corsHeaders);

    // 2. Admin gating
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") return json({ error: "Admin only" }, 403, corsHeaders);

    const workspaceId = await resolveUserWorkspace(supabase, userId);
    if (!workspaceId) return json({ error: "No workspace for user" }, 403, corsHeaders);

    // 3. Rate limit
    const rateLimit = await checkRateLimit(supabase, userId, "user", "admin");
    if (!rateLimit.allowed) {
      return json(
        {
          error: "Rate limit exceeded",
          retry_after: Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000),
        },
        429,
        corsHeaders
      );
    }

    // 4. Validation Zod
    const body = await req.json().catch(() => ({}));
    const validation = validateOrRespond(
      EnqueueImportRequestSchema,
      body,
      corsHeaders,
      "strict",
      { functionName: "enqueue-prospect-import", userId }
    );
    if (validation.response) return validation.response;

    const { source_meta, mapping_used, rows } = validation.data;

    // 5. Soft dedup d'imports identiques (memoire `feedback_prospection`)
    //    Bloque 409 SEULEMENT si l'import precedent a effectivement reussi a
    //    enrichir (au moins 50% des signals ont >= 1 profile en base). Sinon
    //    -> on autorise le retry, parce que l'import precedent a probablement
    //    plante (worker stuck, timeout, etc) et l'admin veut relancer.
    //    Sinon le check 24h bloque l'admin pendant 24h pour un fichier dont
    //    rien n'a ete enrichi -> frustration justifiee (cas observe 18/05).
    if (source_meta.file_hash) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: prior } = await supabase
        .from("prospect_imports")
        .select("id, source_filename, created_at")
        .eq("user_id", userId)
        .eq("source_file_hash", source_meta.file_hash)
        .gte("created_at", since)
        .maybeSingle();
      if (prior) {
        // Mesure le taux d'enrichissement du prior import : combien des signals
        // crees ont au moins 1 prospect_profile associe ?
        const { data: priorStats } = await supabase
          .from("prospect_signals")
          .select("id, status")
          .eq("import_id", prior.id);
        const totalPriorSignals = priorStats?.length || 0;
        let enrichedCount = 0;
        if (totalPriorSignals > 0) {
          const signalIds = priorStats!.map(s => s.id);
          const { data: profiles } = await supabase
            .from("prospect_profiles")
            .select("source_signal_id")
            .in("source_signal_id", signalIds);
          const enrichedSignalSet = new Set(profiles?.map(p => p.source_signal_id) || []);
          enrichedCount = enrichedSignalSet.size;
        }
        const enrichmentRate = totalPriorSignals > 0 ? enrichedCount / totalPriorSignals : 0;
        if (enrichmentRate >= 0.5) {
          console.log(`[ENQUEUE-IMPORT] Blocking duplicate : prior import ${prior.id} enrichment_rate=${(enrichmentRate * 100).toFixed(0)}%`);
          return json(
            {
              error: "Duplicate import",
              message: `Vous avez déjà importé ce fichier le ${new Date(prior.created_at).toLocaleDateString("fr-FR")} (${prior.source_filename}). Modifiez le fichier ou attendez 24h.`,
              prior_import_id: prior.id,
            },
            409,
            corsHeaders
          );
        }
        console.log(`[ENQUEUE-IMPORT] Allowing retry : prior import ${prior.id} enrichment_rate=${(enrichmentRate * 100).toFixed(0)}% (< 50%, likely failed)`);
      }
    }

    // 6. INSERT prospect_imports (committed_at NULL)
    const { data: importRow, error: importInsertError } = await supabase
      .from("prospect_imports")
      .insert({
        user_id: userId,
        source_filename: source_meta.filename,
        source_format: source_meta.format,
        source_file_size_bytes: source_meta.size_bytes,
        source_file_hash: source_meta.file_hash || null,
        source_sheet_name: source_meta.sheet_name || null,
        mapping_used: mapping_used,
        rows_detected: rows.length,
      })
      .select("id")
      .single();

    if (importInsertError || !importRow) {
      console.error("[ENQUEUE-IMPORT] Failed to create prospect_imports:", importInsertError);
      return json({ error: "Failed to create import audit row" }, 500, corsHeaders);
    }

    const importId: string = importRow.id;

    // Log audit : import_create
    await supabase.from("prospect_data_access_logs").insert({
      admin_id: userId,
      workspace_id: workspaceId,
      action: "import_create",
      prospect_ids: [],
      metadata: {
        import_id: importId,
        filename: source_meta.filename,
        rows_detected: rows.length,
      },
    });

    // 7. Pour chaque row : lookup, INSERT/UPDATE
    const newSignalIds: string[] = [];
    const rePromotedSignalIds: string[] = [];
    const skippedSignalIds: string[] = [];
    // Signals deja enrichis (>=1 prospect_profile) : on update les meta mais
    // on NE LES ENRICHIT PAS a nouveau (economie crédits FE).
    const alreadyEnrichedSignalIds: string[] = [];
    let rowsFailed = 0;

    for (const row of rows) {
      const companyName = pickCompanyName(row);
      if (!companyName) {
        rowsFailed += 1;
        continue;
      }

      try {
        const doNotOutreach = detectDoNotOutreachReasons(row.pipeline_status);
        const extractedData = buildExtractedData(row);
        const importedMetadata = buildImportedMetadata(row);

        const match = await findExistingSignal(companyName);

        if (match.signal_id) {
          // UPDATE existant : file-wins on metadata, base-wins on enriched fields
          const { data: existing } = await supabase
            .from("prospect_signals")
            .select("extracted_data, imported_metadata")
            .eq("id", match.signal_id)
            .single();

          const existingExtracted = (existing?.extracted_data || {}) as Record<string, unknown>;
          const existingImportedMeta = (existing?.imported_metadata || {}) as Record<string, unknown>;

          // base-wins on enriched : si email/phone déjà présents en base, on garde
          const mergedExtracted: Record<string, unknown> = { ...extractedData };
          for (const key of ["contact_email", "contact_phone"]) {
            if (existingExtracted[key]) mergedExtracted[key] = existingExtracted[key];
          }
          // file-wins sur le reste (contact_name, role, linkedin si valide, adresse, ville)
          for (const key of Object.keys(existingExtracted)) {
            if (!(key in mergedExtracted)) mergedExtracted[key] = existingExtracted[key];
          }

          const mergedImportedMeta = { ...existingImportedMeta, ...importedMetadata };

          const { error: updateError } = await supabase
            .from("prospect_signals")
            .update({
              extracted_data: mergedExtracted,
              imported_metadata: mergedImportedMeta,
              do_not_outreach_reasons: doNotOutreach,
              import_id: importId,
              status: "raw", // re-promotion : sort du filtre dismissed
            })
            .eq("id", match.signal_id);

          if (updateError) {
            console.error(`[ENQUEUE-IMPORT] UPDATE failed for ${match.signal_id}:`, updateError);
            rowsFailed += 1;
            continue;
          }

          // Check si ce signal a deja au moins 1 profile enrichi. Si oui,
          // on update les meta mais on NE LE RE-ENRICHIT PAS (economie credits
          // FE bulk : ~1 cred par contact deja en base inutilement re-paye).
          // L'admin peut forcer un re-enrich en cochant manuellement la ligne
          // dans la preview (decoche par defaut cote UI quand alreadyEnriched).
          const { count: existingProfilesCount } = await supabase
            .from("prospect_profiles")
            .select("id", { count: "exact", head: true })
            .eq("source_signal_id", match.signal_id);
          const isAlreadyEnriched = (existingProfilesCount || 0) > 0;

          if (isAlreadyEnriched) {
            alreadyEnrichedSignalIds.push(match.signal_id);
          } else if (doNotOutreach) {
            skippedSignalIds.push(match.signal_id);
          } else {
            rePromotedSignalIds.push(match.signal_id);
          }
        } else {
          // INSERT nouveau signal
          const { data: inserted, error: insertError } = await supabase
            .from("prospect_signals")
            .insert({
              signal_type: "direct_listing", // pas vraiment un signal, mais respecte la CHECK
              source: "file_upload",
              acquisition_method: "file_upload",
              import_id: importId,
              company_name: companyName,
              extracted_data: extractedData,
              imported_metadata: importedMetadata,
              do_not_outreach_reasons: doNotOutreach,
              status: "raw",
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            console.error(`[ENQUEUE-IMPORT] INSERT failed for "${companyName}":`, insertError);
            rowsFailed += 1;
            continue;
          }

          if (doNotOutreach) {
            skippedSignalIds.push(inserted.id);
          } else {
            newSignalIds.push(inserted.id);
          }
        }
      } catch (err) {
        console.error(`[ENQUEUE-IMPORT] Row processing failed for "${companyName}":`, err);
        rowsFailed += 1;
      }
    }

    // 8. UPDATE prospect_imports avec compteurs + committed_at
    const rowsImported = newSignalIds.length + rePromotedSignalIds.length + skippedSignalIds.length + alreadyEnrichedSignalIds.length;
    await supabase
      .from("prospect_imports")
      .update({
        rows_imported: rowsImported,
        rows_skipped_duplicate: skippedSignalIds.length + alreadyEnrichedSignalIds.length,
        rows_skipped_user: 0,
        rows_failed: rowsFailed,
        committed_at: new Date().toISOString(),
      })
      .eq("id", importId);
    console.log(
      `[ENQUEUE-IMPORT] Import done: new=${newSignalIds.length} repromoted=${rePromotedSignalIds.length} ` +
      `alreadyEnriched=${alreadyEnrichedSignalIds.length} (skip enrich) skipped=${skippedSignalIds.length}`
    );

    // 9. Trigger enrichissement (inclut les skipped_for_outreach : on les enrichit
    //    pour compléter les emails/phones manquants, mais la génération de messages
    //    en aval respectera leur do_not_outreach_reasons et ne créera pas de message)
    const allToEnrich = [...newSignalIds, ...rePromotedSignalIds, ...skippedSignalIds];
    const authHeader = req.headers.get("authorization") || "";
    const enrichmentJobId = await triggerEnrichmentJob(
      allToEnrich,
      authHeader,
      req.headers.get("origin")
    );

    // 10. Log audit : import_commit
    await supabase.from("prospect_data_access_logs").insert({
      admin_id: userId,
      workspace_id: workspaceId,
      action: "import_commit",
      prospect_ids: allToEnrich,
      metadata: {
        import_id: importId,
        rows_imported: rowsImported,
        rows_failed: rowsFailed,
        new_count: newSignalIds.length,
        re_promoted_count: rePromotedSignalIds.length,
        skipped_count: skippedSignalIds.length,
        enrichment_job_id: enrichmentJobId,
      },
    });

    return json(
      {
        import_id: importId,
        total: rows.length,
        new_signal_ids: newSignalIds,
        re_promoted_signal_ids: rePromotedSignalIds,
        skipped_signal_ids: skippedSignalIds,
        rows_failed: rowsFailed,
        enrichment_job_id: enrichmentJobId,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    console.error("[ENQUEUE-IMPORT] Unhandled error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
      corsHeaders
    );
  }
});

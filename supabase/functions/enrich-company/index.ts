import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";
import { resolveEnricherForDefaultWorkspace, resolveLLM } from "../_shared/providers/registry.ts";
import type { LLMHandle } from "../_shared/providers/types.ts";
import { loadActivePersonas } from "../_shared/workspace-config.ts";
import { buildPersonaSearch, buildRoleDefinition, matchesPersonaTitle, legacyTargetCategory } from "../_shared/persona-enrichment-core.ts";
import type { PersonaConfig } from "../_shared/workspace-config-core.ts";
import { searchBrave } from "../_shared/brave-linkedin-search.ts";
import {
  enrichContactsViaFullEnrich,
  pickBestEmailWithSource,
  type EmailSource,
  searchContactsAtCompany,
  searchContactsAtCompanyCascade,
  filterOutRecruiters,
  isCreditsExhaustedError,
  type FullEnrichContactInput,
  type FullEnrichContactResult,
  type FullEnrichSearchPerson,
  type SearchFilter,
} from "../_shared/fullenrich.ts";
import { findCompanyByName, type SireneCompany } from "../_shared/insee-sirene.ts";
import { buildGeoCascade, stripGeoSuffix } from "../_shared/geo-cascade.ts";
import { normalizeLinkedinUrl } from "../_shared/linkedin-validator.ts";
import { resolveCompany, isForeignNamesake, type ResolvedCompany } from "../_shared/fullenrich-company-resolve.ts";
import { validateCandidatesWithAI } from "../_shared/ai-role-validator.ts";
import { buildCheckWebhook, buildFullenrichWebhookUrl } from "../_shared/fullenrich-webhook-helpers.ts";
// Apify scrape retire d'enrich-company 19/05 : on n'utilise plus le snapshot
// LinkedIn deep (since 24/04 templates determinist remplacant Claude perso).
// Le LinkedIn URL vient deja de FE /people/search (social_profiles.professional_network.url),
// pas besoin d'Apify pour ouvrir le profil. Apify coutait ~30-60s wall time
// + 5-10 crédits par signal pour rien -> on faisait planter Supabase Edge
// runtime sur les boites lourdes. Refresh ponctuel via refresh-prospect-linkedin-snapshots
// si vraiment besoin du snapshot (cas rare).
import { detectPattern, type EmailSample } from "../_shared/email-pattern.ts";
import { logEmailGenerated } from "../_shared/audit-events.ts";
import { reconstructNameFromEmail } from "../_shared/name-reconstruction.ts";

// =============================================================================
// Helpers — Résolution pays de recherche depuis trigger
// =============================================================================

/** Pays de recherche depuis geo_filters du trigger (défaut FR). Code ISO majuscule. */
function resolveSearchCountry(geoFilters: unknown): string {
  if (Array.isArray(geoFilters) && geoFilters.length > 0) {
    const c = (geoFilters[0] as { country?: string } | null)?.country;
    if (typeof c === "string" && c.trim()) return c.trim().toUpperCase();
  }
  return "FR";
}

// =============================================================================
// Filtres de qualification de contact — remplacés par matchesPersonaTitle
// =============================================================================
// Les regex hardcodées (isStrictHrRole, isStrictDirectorRole, isCommercialRole)
// sont remplacées par matchesPersonaTitle() qui utilise les job_title_keywords
// et department_patterns du persona (définis dans icp_personas). Cela permet
// une configuration par-workspace sans hardcodage.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

interface EnrichCompanyBody {
  /** Mode single-shot : enrichit juste ce signal (admin JWT requis). */
  signal_id?: string;
  /** Mode worker : claim le prochain item du job et enrichit (service_role requis). */
  job_id?: string;
}

const EnrichCompanyRequestSchema = z.object({
  signal_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
}).passthrough();

interface EnrichCompanyResponse {
  job_id?: string;
  item_id?: string;
  signal_id: string | null;
  company: string | null;
  company_group_id: string | null;
  profiles_created: number;
  emails_found: number;
  remaining?: number;
  dismissed_reason?: string;
  skipped?: string;
}

interface ProfileQueueItem {
  profile_data: {
    first_name: string;
    last_name: string;
    email: string | null;
    email_source: EmailSource | null;
    phone: string | null;
    job_title: string | null;
    company_name: string;
    company_siren: string | null;
    company_size: string | null;
    company_sector: string | null;
    company_city: string | null;
    target_category: "director" | "field_sales" | "hr" | null;
    persona_id: string;
    linkedin_url: string | null;
    instagram_url: string | null;
    tiktok_url: string | null;
    source_signal_id: string;
    company_group_id: string;
    status: string;
    enrichment_data?: Record<string, unknown>;
  };
}

// =============================================================================
// Entry point — 2 modes :
//   - worker : body {job_id}, service_role, claim + process + re-spawn
//   - single : body {signal_id}, admin JWT, process direct (debug/retry manuel)
// =============================================================================

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as EnrichCompanyBody;
    const _validation = validateOrRespond(EnrichCompanyRequestSchema, body, corsHeaders, "strict", { functionName: "enrich-company" });
    if (_validation.response) return _validation.response;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // =========================================================================
    // Mode worker : auth service_role uniquement (appel pg_net entre workers)
    // =========================================================================
    if (body.job_id) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      // Accepte le JWT legacy (INTERNAL_WORKER_JWT) ou la nouvelle cle
      // SUPABASE_SERVICE_ROLE_KEY (sb_secret_*). Le gateway verify_jwt=true
      // ne laisse passer que le JWT legacy de toute facon, mais on garde
      // la double check pour future migration.
      const workerJwt = Deno.env.get("INTERNAL_WORKER_JWT") || "";
      if (token !== serviceRoleKey && token !== workerJwt) {
        return json({ error: "Worker mode requires service_role" }, 401, corsHeaders);
      }

      const claim = await supabase.rpc("claim_next_enrichment_item", { p_job_id: body.job_id });
      if (claim.error) {
        throw new Error(`claim_next_enrichment_item failed: ${claim.error.message}`);
      }
      const claimRow = Array.isArray(claim.data) ? claim.data[0] : null;
      if (!claimRow) {
        console.log(`[enrich-company] No pending items for job ${body.job_id}, worker exiting`);
        return json({ job_id: body.job_id, skipped: "no_pending_items" }, 200, corsHeaders);
      }
      // OUT params de la RPC : out_item_id, out_signal_id, out_attempts
      const itemId = claimRow.out_item_id as string;
      const signalId = claimRow.out_signal_id as string;

      const processingStart = Date.now();
      let result: EnrichCompanyResponse;
      let success = true;
      let errorMessage: string | null = null;
      let creditsExhausted = false;

      try {
        // Timeout global hard 5 min : protege contre les hang silencieux d'un
        // fetch externe sans timeout (rate limiter loop, bulk enrich poll,
        // Apify, Brave fallback). On a deja des timeouts unitaires (Claude
        // 10s, Brave pre-seed 8s, /people/search cascade 90s) mais le worker
        // entier doit avoir un cap pour eviter de bloquer un slot 6+ min sans
        // raison. Au-dela de 5 min, on throw -> item marque failed,
        // l'admin peut retry via expand-prospect-profiles.
        const WORKER_HARD_TIMEOUT_MS = 5 * 60_000;
        result = await Promise.race([
          processSignal(supabase, signalId, { functionsUrl: supabaseUrl + "/functions/v1", serviceRoleKey }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Worker global timeout ${WORKER_HARD_TIMEOUT_MS / 1000}s — silent fetch hang likely`)),
              WORKER_HARD_TIMEOUT_MS,
            )
          ),
        ]);
      } catch (err) {
        success = false;
        errorMessage = err instanceof Error ? err.message : String(err);
        creditsExhausted = isCreditsExhaustedError(err);
        console.error(`[enrich-company] Processing failed for signal ${signalId}:`, errorMessage);
        result = {
          job_id: body.job_id,
          item_id: itemId,
          signal_id: signalId,
          company: null,
          company_group_id: null,
          profiles_created: 0,
          emails_found: 0,
        };
      }

      // Credits FullEnrich epuises : stop net. On kill tous les items
      // pending/processing + le job, et on ne spawn PAS de nouveau worker.
      // L'item courant est marque failed par kill_enrichment_job, pas besoin
      // d'appeler complete_enrichment_item (qui updatererait le compteur).
      if (creditsExhausted) {
        console.error(`[enrich-company] FullEnrich credits exhausted — killing job ${body.job_id}`);
        const kill = await supabase.rpc("kill_enrichment_job", {
          p_job_id: body.job_id,
          p_reason: "fullenrich_credits_exhausted",
        });
        if (kill.error) {
          console.error(`[enrich-company] kill_enrichment_job failed:`, kill.error.message);
        } else {
          const killedCount = (kill.data?.[0]?.killed_items as number | undefined) ?? 0;
          console.log(`[enrich-company] Killed ${killedCount} items for job ${body.job_id}`);
        }
        return json({
          ...result,
          job_id: body.job_id,
          item_id: itemId,
          killed: "fullenrich_credits_exhausted",
        }, 200, corsHeaders);
      }

      // Marque l'item + update progress + completer le job si plus rien a faire
      const complete = await supabase.rpc("complete_enrichment_item", {
        p_item_id: itemId,
        p_success: success,
        p_error: errorMessage,
      });
      if (complete.error) {
        console.error(`[enrich-company] complete_enrichment_item failed:`, complete.error.message);
      }
      // OUT params : out_job_id, out_remaining, out_job_completed
      const remaining = (complete.data?.[0]?.out_remaining as number | undefined) ?? 0;
      const jobCompleted = (complete.data?.[0]?.out_job_completed as boolean | undefined) ?? false;

      console.log(
        `[enrich-company] Worker done in ${Math.round((Date.now() - processingStart) / 1000)}s ` +
        `(job=${body.job_id} item=${itemId} signal=${signalId} success=${success} remaining=${remaining})`
      );

      // Re-propage un worker tant qu'il reste du travail. pg_net plutot que
      // fetch() Deno : les promesses non-await sont tuees a la fin du handler
      // Edge, pg_net est stateful et garantit le POST meme apres retour.
      if (remaining > 0) {
        const spawn = await supabase.rpc("spawn_enrichment_worker", {
          p_functions_url: supabaseUrl + "/functions/v1",
          p_service_role_key: workerJwt || serviceRoleKey,
          p_job_id: body.job_id,
        });
        if (spawn.error) {
          console.error(`[enrich-company] spawn_enrichment_worker failed:`, spawn.error.message);
        }
      } else if (jobCompleted) {
        // Trou de queue : le bouncer-batch fire-and-forget par entreprise
        // (fin de processSignal) peut etre tue a la fin du handler du dernier
        // worker → les derniers profils restent sans verdict. Backstop : un
        // balayage global via pg_net (garanti post-handler), idempotent
        // (ne reprend que les profils deliverability_status NULL).
        const sweep = await supabase.rpc("spawn_bouncer_sweep", {
          p_functions_url: supabaseUrl + "/functions/v1",
          p_service_role_key: serviceRoleKey,
        });
        if (sweep.error) {
          console.error(`[enrich-company] spawn_bouncer_sweep failed:`, sweep.error.message);
        } else {
          console.log(`[enrich-company] Job ${body.job_id} completed — bouncer sweep spawned`);
        }
      }

      return json({
        ...result,
        job_id: body.job_id,
        item_id: itemId,
        remaining,
      }, 200, corsHeaders);
    }

    // =========================================================================
    // Mode single-shot : admin JWT + signal_id explicite
    // =========================================================================
    if (!body.signal_id) {
      return json({ error: "Missing signal_id or job_id" }, 400, corsHeaders);
    }

    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Admin only" }, 403, corsHeaders);
    }

    const result = await processSignal(
      supabase,
      body.signal_id,
      { functionsUrl: supabaseUrl + "/functions/v1", serviceRoleKey },
    );
    return json(result, 200, corsHeaders);

  } catch (err) {
    console.error("[enrich-company] Error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
      getCorsHeaders(req.headers.get("origin")),
    );
  }
});

function json(payload: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =============================================================================
// updateDomainPatternsFromQueue — calcule + upsert le pattern email d'un
// domaine apres enrichment.
//
// Pour chaque domaine present dans profileQueue (avec un email enrichi), on
// recupere TOUS les emails connus de ce domaine en base (autres groups du
// meme employeur, anciens runs, etc.) + ceux qu'on vient d'enrichir, puis
// on detecte le pattern dominant. Si tier != skip, on upsert.
//
// Cette table sert a la deduction d'emails dans enrich-deduced-emails :
// quand un nouveau profil arrive sans email mais qu'on connait le pattern
// du domaine, on construit l'email automatiquement (tier high) ou on le
// queue pour verification Reoon (tier medium).
// =============================================================================
async function updateDomainPatternsFromQueue(
  supabase: SupabaseClient,
  profileQueue: ProfileQueueItem[],
): Promise<void> {
  // Domaines presents dans la queue (au moins 1 email enrichi)
  const domains = new Set<string>();
  for (const item of profileQueue) {
    const email = item.profile_data.email;
    if (!email) continue;
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain) domains.add(domain);
  }
  if (domains.size === 0) return;

  for (const domain of domains) {
    // Recupere tous les emails connus pour ce domaine (en base + queue)
    const { data: existing, error } = await supabase
      .from("prospect_profiles")
      .select("first_name, last_name, email")
      .ilike("email", `%@${domain}`)
      .is("deleted_at", null)
      .limit(500);

    if (error) {
      console.warn(`[enrich-company] domain pattern fetch failed for ${domain}: ${error.message}`);
      continue;
    }

    const samples: EmailSample[] = [
      ...(existing || []),
      ...profileQueue
        .map(p => p.profile_data)
        .filter(p => p.email && p.email.toLowerCase().endsWith(`@${domain}`))
        .map(p => ({ first_name: p.first_name, last_name: p.last_name, email: p.email })),
    ];

    // Dedup par email (au cas ou la queue contient des profils deja en base
    // — peu probable, mais securite)
    const seen = new Set<string>();
    const unique = samples.filter(s => {
      if (!s.email) return false;
      const key = s.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length < 3) {
      // Pas assez de signaux pour un pattern fiable
      continue;
    }

    const result = detectPattern(unique);
    if (!result.pattern || result.tier === "skip") {
      console.log(`[enrich-company] domain ${domain}: pattern skip (${result.confidence.toFixed(2)} confidence on ${result.total} samples)`);
      continue;
    }

    const { error: upsertErr } = await supabase
      .from("domain_email_patterns")
      .upsert({
        domain,
        pattern: result.pattern,
        confidence: result.confidence,
        tier: result.tier,
        sample_count: result.total,
        hits: result.hits,
        secondary_pattern: result.secondary?.pattern ?? null,
        secondary_hits: result.secondary?.hits ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "domain" });

    if (upsertErr) {
      console.warn(`[enrich-company] domain pattern upsert failed for ${domain}: ${upsertErr.message}`);
    } else {
      console.log(
        `[enrich-company] domain ${domain}: pattern="${result.pattern}" tier=${result.tier} conf=${result.confidence.toFixed(2)} (${result.hits}/${result.total})`,
      );
    }
  }
}

// =============================================================================
// processSignal — pipeline d'enrichissement d'un signal
//
//   1. Fetch signal + extract company_name + reuse/create company_group_id
//   2. 3 searches FullEnrich parallele (HR, DirCo, Sales) → filtrage strict
//   3. Fallback Brave si FullEnrich vide sur HR+DirCo
//   4. Detection cabinet de recrutement (dismiss si >60% recruteurs)
//   5. Parallele : FullEnrich bulk (emails) + Apify snapshot + INSEE
//   5b. MAJ pattern email domaine (sert a la deduction future)
//   6. Dedup par linkedin_url/nom, insert profils
//   7. Update signal → 'matched', trigger messages bulk
// =============================================================================
async function processSignal(
  supabase: SupabaseClient,
  signalId: string,
  ctx: { functionsUrl: string; serviceRoleKey: string },
): Promise<EnrichCompanyResponse> {
  const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY");

  // Resout l'enricher ACTIF via le registry de providers (dispatch).
  // V1 : workspace par defaut (la resolution se fait avant le chargement du signal).
  let fullenrichKey: string;
  try {
    const { context } = await resolveEnricherForDefaultWorkspace(supabase);
    fullenrichKey = context.apiKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`FullEnrich provider not configured: ${msg}`);
  }

  // ─── 1. Signal + company_name + workspace_id ──────────────────────────────
  console.log(`[enrich-company] Fetching signal: ${signalId}`);
  const { data: signal, error: signalError } = await supabase
    .from("prospect_signals")
    .select("*")
    .eq("id", signalId)
    .single();

  if (signalError || !signal) {
    throw new Error(`Failed to fetch signal: ${signalError?.message}`);
  }

  const workspaceId = signal.workspace_id as string;
  if (!workspaceId) {
    throw new Error(`Signal ${signalId} has no workspace_id - data integrity issue`);
  }

  // Charge les personas ACTIFS du workspace. Fail-fast si aucun.
  let personas: PersonaConfig[];
  try {
    personas = await loadActivePersonas(supabase, workspaceId);
  } catch (err) {
    const code = (err instanceof Object && 'code' in err) ? (err as Record<string, unknown>).code : 'unknown';
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 'no_active_personas') {
      throw new Error(`Workspace ${workspaceId} has no active personas — configure prospection in the UI`);
    }
    throw new Error(`Failed to load personas: ${msg}`);
  }
  console.log(`[enrich-company] Loaded ${personas.length} active personas for workspace ${workspaceId}`);

  const companyName: string = signal.extracted_data?.company_name || signal.company_name;
  if (!companyName) {
    throw new Error("No company_name found in signal");
  }

  // ─── Résolution du pays de recherche depuis trigger ───────────────────────
  let searchCountry = "FR";
  if (signal.trigger_id) {
    const { data: trig } = await supabase
      .from("signal_triggers").select("geo_filters").eq("id", signal.trigger_id).maybeSingle();
    searchCountry = resolveSearchCountry(trig?.geo_filters);
  }
  const isFrance = searchCountry === "FR";
  console.log(`[enrich-company] Resolved searchCountry: "${searchCountry}" (isFrance=${isFrance})`);

  // NB : le filtrage des cabinets de recrutement se fait au scraping
  // (_shared/scrapers/signal-processor.ts, blacklist DB + patterns).
  // Si un signal arrive ici, il a deja passe le filtre. La detection >60%
  // recruteurs au step 4 ci-dessous reste comme filet final via FullEnrich.

  // Extract target city from signal location. Format FT/Adzuna : "26 - Montélimar".
  const signalLocation = (signal.extracted_data?.location as string) || "";
  const targetCity = signalLocation
    .replace(/^\d+\s*-\s*/, "")
    .replace(/,.*$/, "")
    .trim()
    .toLowerCase();

  // Dedup (company_name, city) sur 60j : on saute l'enrichissement si la meme
  // boite a deja ete enrichie a la meme ville recemment. On distingue les
  // filiales (POINT.P Lyon != POINT.P Nantes) tout en evitant de cramer des
  // credits sur des doublons. Sans city dans le signal, on dedup sur le nom seul.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const { data: existingProfiles } = await supabase
    .from("prospect_profiles")
    .select("company_group_id, company_city")
    .ilike("company_name", companyName)
    .gt("created_at", sixtyDaysAgo)
    .is("deleted_at", null)
    .limit(50);

  const isSameCity = (existingCity: string | null): boolean => {
    if (!existingCity || !targetCity) return !targetCity && !existingCity;
    const a = existingCity.toLowerCase().trim();
    const b = targetCity;
    return a === b || a.includes(b) || b.includes(a);
  };
  const duplicate = existingProfiles?.find(p => isSameCity(p.company_city));

  if (duplicate) {
    console.log(`[enrich-company] SKIP duplicate: "${companyName}" deja enrichie a "${targetCity || "(no city)"}" dans les 60j`);
    await supabase.from("prospect_signals").update({
      status: "dismissed",
      extracted_data: { ...signal.extracted_data, dedup_skip_reason: `already_enriched_at_${targetCity || "unknown"}` },
    }).eq("id", signalId);
    return {
      signal_id: signalId,
      company: companyName,
      company_group_id: duplicate.company_group_id,
      profiles_created: 0,
      emails_found: 0,
      dismissed_reason: `Company "${companyName}" deja enrichie a ${targetCity || "(meme localisation)"} dans les 60 derniers jours`,
    };
  }

  // Reuse company_group_id si meme boite enrichie ailleurs (filiale differente).
  const companyGroupId = existingProfiles?.[0]?.company_group_id ?? crypto.randomUUID();
  // existingGroup = true si on reutilise un group_id deja en base. Utilise
  // plus bas pour le dedup des profiles (eviter de re-inserer un contact
  // qui existe deja dans ce group). Le refactor du 24/04 (bd34239e) avait
  // retire la declaration mais garde l'usage -> ReferenceError sur les
  // imports recents qui reutilisent un group existant. Fix 2026-05-12.
  const existingGroup = (existingProfiles?.length ?? 0) > 0;
  console.log(
    `[enrich-company] Processing company: ${companyName} @ ${targetCity || "?"} (group: ${companyGroupId}${existingGroup ? " — reused" : " — new"})`
  );

  const profileQueue: ProfileQueueItem[] = [];
  const usedLinkedInUrls = new Set<string>();
  // Dedup supplementaire par nom normalise (first+last) : FE retourne parfois
  // 2 fois la meme personne avec 2 titres differents (ex: "EVP Sales" vs
  // "Executive VP of Sales" pour Aurore Vidal Kerys), et le pre-seed file_upload
  // sans LinkedIn ne polluerait pas usedLinkedInUrls -> doublon createur.
  const usedFullNames = new Set<string>();
  const fullNameKey = (first: string, last: string): string => {
    return (first + " " + last)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  };
  const extractedData = signal.extracted_data || {};
  const contactEmail = (extractedData.contact_email as string | null) || null;
  const contactName = (extractedData.contact_name as string | null) || null;
  if (contactEmail || contactName) {
    console.log(`[enrich-company] Signal contact (non classifie): ${contactName || "?"} <${contactEmail || "no email"}>`);
  }

  const pushProfile = (
    firstName: string,
    lastName: string,
    jobTitle: string,
    linkedinUrl: string | null,
    persona: PersonaConfig,
    seed?: Partial<{ email: string; email_source: string; phone: string }>,
  ) => {
    // Dedup par nom normalise : evite Aurore Vidal "EVP Sales" + "Executive
    // VP of Sales" en doublon. Si on a deja un profile au meme nom :
    //   - Si l'existant n'a pas de LinkedIn et qu'on en a un -> on update
    //     l'existant (pour ne pas perdre l'info riche du 2e match).
    //   - Sinon, on skip ce push.
    const nameKey = fullNameKey(firstName, lastName);
    if (nameKey && usedFullNames.has(nameKey)) {
      const existing = profileQueue.find(p => fullNameKey(p.profile_data.first_name as string, p.profile_data.last_name as string) === nameKey);
      if (existing && !existing.profile_data.linkedin_url && linkedinUrl) {
        existing.profile_data.linkedin_url = linkedinUrl;
        // Update aussi le titre si on a un titre plus precis (l'ancien etait "(rôle non précisé)")
        if (jobTitle && existing.profile_data.job_title === "(rôle non précisé)") {
          existing.profile_data.job_title = jobTitle;
        }
        console.log(`[enrich-company] MERGED LinkedIn for "${firstName} ${lastName}" -> ${linkedinUrl}`);
      } else {
        console.log(`[enrich-company] SKIP duplicate name: "${firstName} ${lastName}" (${jobTitle})`);
      }
      return;
    }
    if (nameKey) usedFullNames.add(nameKey);
    profileQueue.push({
      profile_data: {
        first_name: firstName,
        last_name: lastName,
        email: seed?.email ?? null,
        email_source: seed?.email_source ?? null,
        phone: seed?.phone ?? null,
        job_title: jobTitle,
        company_name: companyName,
        company_siren: null,
        company_size: null,
        company_sector: null,
        company_city: null,
        target_category: legacyTargetCategory(persona.slug),
        persona_id: persona.id,
        linkedin_url: linkedinUrl,
        instagram_url: null,
        tiktok_url: null,
        source_signal_id: signalId,
        company_group_id: companyGroupId,
        status: "new",
      },
    });
  };

  // ─── Pre-seed avec les contacts importes via fichier ──────────────────
  // Si le signal vient d'un import fichier (acquisition_method='file_upload'),
  // les contacts identifies manuellement par l'admin sont dans extracted_data.
  // On les injecte AVANT FullEnrich pour :
  //   1) Conserver les contacts qu'Alex a curés (FullEnrich peut les manquer)
  //   2) Garder le rôle exact mappé depuis le fichier
  //   3) Permettre au dedup downstream (LinkedIn URL / nom) de skip si
  //      FullEnrich retrouve la même personne
  // FullEnrich va quand meme tourner pour decouvrir d'autres contacts (autres
  // RH, Dir Co, commerciaux) que l'admin n'avait pas identifies.
  if (signal.acquisition_method === "file_upload") {
    const firstName = String(extractedData.contact_first_name || "").trim();
    const lastName = String(extractedData.contact_last_name || "").trim();
    const role = String(extractedData.contact_role || "").trim();
    // Normalise les sous-domaines pays (fr.linkedin.com -> www.linkedin.com)
    // pour passer la CHECK constraint prospect_profiles_linkedin_url_check.
    const rawLinkedin = extractedData.linkedin_url as string | null;
    let importedLinkedin = normalizeLinkedinUrl(rawLinkedin);

    // Alex met souvent dans le fichier des URLs de RECHERCHE LinkedIn comme
    //   https://www.linkedin.com/search/results/people/?keywords=stephane%20vergnes%20equans
    // Notre validator les rejette (search URL != profile direct). Mais les
    // keywords sont riches : nom + prenom + entreprise. On les resout via
    // Brave pour trouver le profil reel correspondant.
    // Inutile si on a deja un LinkedIn valide.
    if (!importedLinkedin && rawLinkedin && /linkedin\.com\/search/i.test(rawLinkedin) && braveKey) {
      try {
        const u = new URL(rawLinkedin);
        const kw = u.searchParams.get("keywords");
        if (kw) {
          const decoded = decodeURIComponent(kw);
          const query = `"${decoded}" site:linkedin.com/in/`;
          // Timeout 8s sur Brave : evite que le pre-seed hang si Brave est
          // lent / down (cas reel observe : worker bloque 12min sans logs).
          // Si timeout, importedLinkedin reste null → on garde le pre-seed
          // sans LinkedIn (degradation gracieuse).
          const braveResults = await Promise.race([
            searchBrave(query, braveKey, 5),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Brave timeout 8s")), 8_000)
            ),
          ]);
          const firstProfile = braveResults.find(r => /linkedin\.com\/in\//.test(r.url));
          if (firstProfile) {
            const cleaned = firstProfile.url.split("?")[0];
            importedLinkedin = normalizeLinkedinUrl(cleaned);
            console.log(
              `[enrich-company] FILE IMPORT search-URL resolved via Brave: "${decoded}" -> ${importedLinkedin}`
            );
          } else {
            console.log(`[enrich-company] FILE IMPORT search-URL no Brave match: "${decoded}"`);
          }
        }
      } catch (err) {
        console.warn(`[enrich-company] FILE IMPORT search-URL Brave resolve failed: ${(err as Error).message}`);
      }
    }

    const importedEmail = (extractedData.contact_email as string | null) || null;
    const importedPhone = (extractedData.contact_phone as string | null) || null;

    if (firstName || lastName) {
      // Essaie de matcher le role importé à un persona. Fallback au persona
      // par défaut si aucun ne matche. Cela remplace la logique hardcodée
      // hr/director/field_sales.
      const importedRoleTitle = role || "(rôle non précisé)";
      let matchedPersona = personas.find(p => matchesPersonaTitle(importedRoleTitle, p));
      if (!matchedPersona) {
        matchedPersona = personas.find(p => p.is_default) ?? personas[0];
      }

      console.log(
        `[enrich-company] FILE IMPORT pre-seed: ${firstName} ${lastName} (${importedRoleTitle}) → persona ${matchedPersona.slug}`
      );

      pushProfile(
        firstName,
        lastName,
        importedRoleTitle,
        importedLinkedin,
        matchedPersona,
        {
          email: importedEmail || undefined,
          email_source: importedEmail ? "imported" : undefined,
          phone: importedPhone || undefined,
        }
      );

      if (importedLinkedin) {
        usedLinkedInUrls.add(importedLinkedin.toLowerCase().replace(/\/$/, ""));
      }
    }
  }

  const adoptSearchPerson = (p: FullEnrichSearchPerson, persona: PersonaConfig) => {
    const firstName = p.first_name || "";
    const lastName = p.last_name || "";
    const title = p.employment?.current?.title || "";
    const linkedinUrl = p.social_profiles?.professional_network?.url || null;
    if (!firstName || !lastName) return;
    pushProfile(
      firstName,
      lastName,
      title || persona.label,
      linkedinUrl,
      persona,
    );
  };

  // ─── 2. FullEnrich /people/search parallele (avec cascade geo) ────────────
  //
  // On lance d'abord INSEE pour deduire la cascade (ville / dept / region /
  // pays) depuis l'adresse de l'entreprise. Permet de cibler la filiale
  // locale au lieu de cramer 10 credits sur 10 contacts disperses en France.
  // Cf. _shared/geo-cascade.ts pour le rationale et les tests empiriques.
  //
  // Budget : ~200-500ms ajoutes pour le pre-await INSEE, mais economie de
  // ~80% des credits FullEnrich sur les multinationales. Si INSEE timeout
  // ou rien retourne, fallback automatique sur cascade ["France"] (=
  // comportement avant le changement).
  // Gate : INSEE (registre FR) actif uniquement si searchCountry="FR".
  const inseePromise = isFrance
    ? findCompanyByName(companyName).catch(err => {
        console.warn(`[enrich-company] INSEE pre-fetch failed: ${errStr(err)}`);
        return null as SireneCompany | null;
      })
    : Promise.resolve(null);

  // En parallele : resolution FullEnrich /company/search. Convertit le nom
  // approximatif (Saint-Laurent, Nissan France, CCEP) en ID canonique FE +
  // domaine + HQ. Permet de passer current_company_ids dans /people/search
  // au lieu de current_company_names → debloque ~60% des grandes boites qui
  // retournaient 0 contacts avec matching strict par nom.
  // Cache 30j cote helper → 0 cout sur les repetitions.
  // Cf. _shared/fullenrich-company-resolve.ts.
  // LLM actif du workspace (anthropic par défaut, openai_compatible possible).
  // null si aucun provider llm configuré → les étapes IA dégradent en regex.
  const llm: LLMHandle | null = await resolveLLM(supabase, workspaceId).catch((err) => {
    console.warn(`[enrich-company] resolveLLM failed (fallback regex): ${errStr(err)}`);
    return null;
  });
  const resolvePromise: Promise<ResolvedCompany | null> = resolveCompany(
    supabase,
    fullenrichKey,
    companyName,
    { country_code: searchCountry, llm },
  ).catch(err => {
    console.warn(`[enrich-company] resolveCompany failed: ${errStr(err)}`);
    return null;
  });

  // Attente parallele : INSEE 1.5s, resolveCompany 20s.
  // FullEnrich /company/search prend ~8-10s par call et la cascade peut faire
  // jusqu'a 3 appels (name exact -> name fuzzy FR -> name fuzzy seul) si les
  // premiers ratent. Empiriquement : Mann+Hummel resolu en 1s (1er call),
  // Saint-Laurent / Nissan en 25-30s (cascade complete). Un timeout court
  // faisait perdre les resolutions reussies en cascade : le call retournait
  // certes mais APRES qu'on soit deja parti sur companyNames. Cache 30j cote
  // helper amortit au 2eme passage. Si resolve timeout : on tombe sur INSEE
  // + companyNames (ancien comportement) sans casse.
  const [sireneEarly, resolved] = await Promise.all([
    Promise.race([
      inseePromise,
      new Promise<SireneCompany | null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]),
    Promise.race([
      resolvePromise,
      new Promise<ResolvedCompany | null>((resolve) => setTimeout(() => resolve(null), 30_000)),
    ]),
  ]);

  // Persist la resolution canonique sur le signal pour reutilisation downstream
  // (bouncer, deduction email, cross-references entre signaux de la meme boite).
  if (resolved) {
    console.log(
      `[enrich-company] canonical resolved: "${companyName}" -> "${resolved.name}" (id=${resolved.id.substring(0, 8)}…, domain=${resolved.domain || "?"}, hq=${resolved.hq_city || "?"}/${resolved.hq_country_code || "?"})`
    );
    await supabase
      .from("prospect_signals")
      .update({
        fullenrich_company_id: resolved.id,
        company_domain_resolved: resolved.domain,
        company_name_canonical: resolved.name,
      })
      .eq("id", signalId)
      .then(({ error }) => {
        if (error) console.warn(`[enrich-company] persist resolved on signal failed: ${error.message}`);
      });
  }

  // Construction du filtre noms : nom scrapper en priorite + nom officiel
  // INSEE comme alternative si different. Le scrapper FT/Adzuna peut donner
  // un nom commercial mal extrait (ex: "SECURITAS DIRECT-AROUNDIO") alors
  // que la denomination legale est differente (ex: "VERISURE"). FullEnrich
  // /people/search avec exact_match cherche TOUS les match -> on rate les
  // employes qui se declarent sous le nom officiel. En passant les 2 noms
  // en OR, on capture les profils peu importe la convention LinkedIn.
  const companyFilter: SearchFilter[] = [{ value: companyName, exact_match: true }];
  const inseeName = sireneEarly?.name?.trim();
  if (inseeName && inseeName.toLowerCase() !== companyName.toLowerCase()) {
    companyFilter.push({ value: inseeName, exact_match: true });
    console.log(`[enrich-company] companyFilter added INSEE name: "${inseeName}"`);
  }

  // Strip suffixe regional ("IDEA Nouvelle Aquitaine" -> "IDEA"). Sur LinkedIn,
  // les employes d'une filiale regionale ecrivent souvent juste "IDEA" comme
  // employer, la region etant portee par leur location -> exact_match strict
  // ratait ces profils. La cascade geo cote FE filtre ensuite le bon territoire.
  const seenFilterValues = new Set(companyFilter.map(f => f.value.toLowerCase()));
  for (const base of [companyName, inseeName].filter(Boolean) as string[]) {
    const stripped = stripGeoSuffix(base);
    if (stripped && !seenFilterValues.has(stripped.toLowerCase())) {
      companyFilter.push({ value: stripped, exact_match: true });
      seenFilterValues.add(stripped.toLowerCase());
      console.log(`[enrich-company] companyFilter added geo-stripped: "${stripped}" (from "${base}")`);
    }
  }

  // ─── Mode "import leger" pour les signaux file_upload ────────────────
  // L'admin a deja identifie son contact cible dans le fichier, on cherche
  // un renfort raisonnable autour (RH + autres dir co + commerciaux). 3
  // leviers (vs scraping standard) :
  //   1. maxContacts field_sales 20 au lieu de 50 (~5 cred max au lieu de 12.5)
  //      avec minContacts=5 (vs 10 scraping) pour stopper la cascade des qu'on
  //      a un volume raisonnable et eviter de remonter trop loin
  //   2. cascade geo INCLUT France (necessaire pour les commerciaux nationaux
  //      type Coca-Cola, Dacia, Fenwick) — premiere tentative excluait France
  //      mais 14/24 boites finissaient sans aucun commercial trouve
  //   3. timeout 90s par boite (filet anti-blocage type Bonduelle/Fenwick)
  // Coordonnees geo : on injecte aussi city/zip importes depuis le fichier
  // si INSEE n'a rien (cf importedCity/importedZip plus bas).
  // Economie estimee : ~60% de credits par boite vs scraping + < 90s garanti.
  const isFileUploadSignal = signal.acquisition_method === "file_upload";
  // Timeout sur la triple recherche FullEnrich par persona. Remplace les caps
  // hardcodées (hrSearchMax, dirSearchMax, fieldSalesMaxContacts, etc.) qui
  // viennent maintenant de enrichment_caps pour chaque persona.
  const searchTimeoutMs = 120_000;

  // Pour les imports, l'admin a souvent mis l'adresse complete dans le fichier
  // (ex: "27 avenue Franklin Roosevelt, 35400 Saint-Malo"). INSEE peut ne pas
  // retrouver la boite (marques commerciales sans entite legale claire type
  // "Alpine (Renault)") → sireneEarly null → cascade vide → fallback "France"
  // qui rate l'info geo. On fallback sur city/zip importes, soit explicites
  // dans extracted_data soit parses depuis l'adresse via regex.
  let importedCity: string | null = null;
  let importedZip: string | null = null;
  if (isFileUploadSignal) {
    importedCity = (extractedData.city as string | null) || null;
    const addressStr = (extractedData.address as string | null) || "";
    const zipMatch = addressStr.match(/\b(\d{5})\b/);
    importedZip = zipMatch ? zipMatch[1] : null;
    if (!importedCity && zipMatch) {
      // "12 rue X, 75001 Paris" -> capture "Paris" apres le code postal
      const afterZip = addressStr.slice(addressStr.indexOf(zipMatch[1]) + 5).trim();
      const cityMatch = afterZip.match(/^[\s,]*([\p{L}'\- ]+?)(?:[,;]|$)/u);
      if (cityMatch) importedCity = cityMatch[1].trim();
    }
    if (importedCity || importedZip) {
      console.log(`[enrich-company] file_upload geo from imported address: city="${importedCity}" zip="${importedZip}"`);
    }
  }

  // Priorite geo : adresse importee > INSEE. Justification : pour les marques
  // commerciales ou les noms communs (Saint-Laurent, Mann+Hummel), INSEE
  // retrouve souvent un homonyme aleatoire (ex: un "Saint-Laurent" a
  // Les-Corvees-les-Yys, Eure-et-Loir, pour YSL 75007). L'adresse mise par
  // l'admin est curee a la main → elle est plus fiable.
  // Pour le scraping (pas isFileUploadSignal), comportement inchange : INSEE
  // gagne car on n'a pas d'adresse alternative.
  // FullEnrich /company/search retourne le HQ canonique : sert de filet quand
  // ni l'admin ni INSEE n'ont fourni de city/zip (rare mais ca arrive sur les
  // marques commerciales internationales).
  const resolvedHqCity = resolved?.hq_city || undefined;
  const cascadeCity = isFileUploadSignal
    ? (importedCity || sireneEarly?.city || resolvedHqCity)
    : (sireneEarly?.city || resolvedHqCity);
  const cascadeZip = isFileUploadSignal
    ? (importedZip || sireneEarly?.zip || undefined)
    : (sireneEarly?.zip || undefined);
  // Gate : cascade géographique FR-only (INSEE → depts → régions → France) si isFrance.
  // Sinon : fallback simple [searchCountry] (pas de cascade multi-niveaux FR).
  const geoCascade: SearchFilter[] = isFrance
    ? buildGeoCascade({
        city: cascadeCity,
        postalCode: cascadeZip,
      })
    : [{ value: searchCountry }];
  console.log(
    `[enrich-company] Geo cascade for "${companyName}"${isFileUploadSignal ? " [IMPORT LEGER]" : ""}: ${geoCascade.map(g => g.value).join(" -> ")}`
  );

  // Choix du filtre entreprise pour /people/search :
  //   - Si on a un ID canonique FullEnrich : on l'utilise (100% match garanti)
  //     et on jette companyNames (sinon FE fait un AND entre les 2 filtres,
  //     ce qui re-introduit le bug de matching strict du nom).
  //   - Sinon : ancien comportement (nom scrape + nom INSEE + nom strip geo).
  const companySearchOptions: { companyIds?: SearchFilter[]; companyNames?: SearchFilter[] } = resolved
    ? { companyIds: [{ value: resolved.id, exact_match: true }] }
    : { companyNames: companyFilter };
  if (resolved) {
    console.log(`[enrich-company] /people/search will use companyIds (canonical FE id): ${resolved.id.substring(0, 8)}…`);
  }

  const searchStart = Date.now();

  // Budget FullEnrich search : chaque contact retourne coute ~0.25 credit,
  // les calls vides coutent 0 credit (verifie 04/2026). La cascade s'arrete
  // au premier niveau qui retourne >=1 contact (sauf si keepCap cap les
  // resultats apres filtre IA).
  // maxContacts cap : vient de enrichment_caps.search_max pour chaque persona.
  // Strategy /people/search :
  //   - Si companyId canonique : 1 seul call par persona SANS person_locations.
  //   - Sinon (companyNames) : cascade geo standard Paris -> IDF -> France.
  const useDirectSearch = !!resolved;
  if (useDirectSearch) {
    console.log(`[enrich-company] /people/search direct (companyId, no location filter) — post-filter country=FR coupera les non-FR`);
  }

  // Garde-fou crédits : un homonyme étranger faible confiance (HQ ≠ searchCountry + score bas)
  // donnerait 0 contact FR après post-filtre, mais la recherche est facturée.
  const FOREIGN_SKIP_SCORE = 0.6;
  const skipForeignNamesake = isForeignNamesake(resolved, searchCountry, FOREIGN_SKIP_SCORE);
  if (skipForeignNamesake && resolved) {
    console.log(`[enrich-company] homonyme étranger faible confiance (hq=${resolved.hq_country_code} score=${resolved.match_score.toFixed(2)}) → recherche contacts skippée (économie crédits)`);
  }

  // Wrapper : adapte searchContactsAtCompany pour matcher la shape de cascade.
  const directSearch = async (opts: Parameters<typeof searchContactsAtCompany>[1]) => {
    const r = await searchContactsAtCompany(fullenrichKey, opts);
    return { ...r, stoppedAtLevel: 0 as const, stoppedAtValue: "(no geo filter, companyId)" };
  };

  // Une recherche FullEnrich par persona (remplace les 3 recherches hr/dir/sales fixes).
  const runPersonaSearch = (persona: PersonaConfig) => {
    const s = buildPersonaSearch(persona);
    const opts = {
      ...companySearchOptions,
      ...(s.positionTitles ? { positionTitles: s.positionTitles } : {}),
      ...(s.seniorityLevels ? { seniorityLevels: s.seniorityLevels } : {}),
      maxContacts: s.maxContacts,
    };
    return useDirectSearch
      ? directSearch(opts)
      : searchContactsAtCompanyCascade(fullenrichKey, opts, geoCascade, s.minContacts);
  };

  // IMPORTANT : Promise.allSettled preserve l'ordre. personaResults[i] <-> personas[i]
  // tout au long de la fonction (recherche, filtre, adoption). Ne pas filtrer personas
  // apres ce point sans reindexer.

  type SearchResult = { status: "fulfilled"; value: Awaited<ReturnType<typeof searchContactsAtCompanyCascade>> } | { status: "rejected"; reason: unknown };
  const timedOutSentinel: SearchResult = { status: "rejected", reason: new Error("Search timed out") };
  const skippedSentinel: SearchResult = { status: "rejected", reason: new Error("skipped: foreign namesake") };

  let personaResults: SearchResult[];

  if (skipForeignNamesake) {
    personaResults = personas.map(() => skippedSentinel);
  } else {
    const searchPromise = Promise.allSettled(personas.map(runPersonaSearch));
    if (searchTimeoutMs > 0) {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), searchTimeoutMs));
      const winner = await Promise.race([searchPromise, timeoutPromise]);
      if (winner === null) {
        console.warn(`[enrich-company] FullEnrich search TIMED OUT after ${searchTimeoutMs / 1000}s on "${companyName}" — continuing with pre-seeded contact only`);
        personaResults = personas.map(() => timedOutSentinel);
      } else {
        personaResults = winner;
      }
    } else {
      personaResults = await searchPromise;
    }
  }

  const logCascadeStop = (label: string, r: SearchResult) => {
    if (r.status === "fulfilled") {
      const v = r.value;
      console.log(
        `[enrich-company] ${label} cascade: ${v.people.length} contacts, ${v.creditsUsed.toFixed(2)} credits, stop="${v.stoppedAtValue || "(rien)"}" (level=${v.stoppedAtLevel})`
      );
    }
  };
  for (let i = 0; i < personas.length; i++) {
    logCascadeStop(`Persona[${i}] ${personas[i].slug}`, personaResults[i]);
  }
  console.log(`[enrich-company] FullEnrich ${personas.length} persona searches done in ${Math.round((Date.now() - searchStart) / 1000)}s`);

  // ─── Fallback companyNames si companyIds n'a rien trouve ───────────────
  const totalFound = (r: SearchResult): number => r.status === "fulfilled" ? r.value.people.length : 0;
  const sumFound = personaResults.reduce((acc, r) => acc + totalFound(r), 0);
  if (resolved && sumFound === 0 && !skipForeignNamesake) {
    console.log(
      `[enrich-company] Fallback: companyIds (${resolved.id.substring(0, 8)}…) retourne 0 contacts ` +
      `-> retry avec companyNames (${companyFilter.length} variantes)`
    );
    const fallbackStart = Date.now();
    const fallbackPromise = Promise.allSettled(
      personas.map(persona => {
        const s = buildPersonaSearch(persona);
        const opts = {
          companyNames: companyFilter,
          ...(s.positionTitles ? { positionTitles: s.positionTitles } : {}),
          ...(s.seniorityLevels ? { seniorityLevels: s.seniorityLevels } : {}),
          maxContacts: s.maxContacts,
        };
        return searchContactsAtCompanyCascade(fullenrichKey, opts, geoCascade, s.minContacts);
      })
    );

    if (searchTimeoutMs > 0) {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), searchTimeoutMs));
      const winner = await Promise.race([fallbackPromise, timeoutPromise]);
      if (winner !== null) {
        personaResults = winner;
      }
    } else {
      personaResults = await fallbackPromise;
    }
    for (let i = 0; i < personas.length; i++) {
      logCascadeStop(`Persona[${i}] ${personas[i].slug} (fallback)`, personaResults[i]);
    }
    console.log(`[enrich-company] Fallback companyNames done in ${Math.round((Date.now() - fallbackStart) / 1000)}s`);
  }

  // ─── Post-filter pays = searchCountry ─────────────────────────────────────
  // Gate : filtre géographique FR stricte appliqué uniquement si isFrance.
  // Pour les marchés non-FR, pas de filtre pays : on laisse passer tous les contacts.
  {
    const filterByCountry = (r: SearchResult): SearchResult => {
      if (r.status !== "fulfilled") return r;
      // Si non-FR, pas de filtre : tous les contacts sont acceptés
      if (!isFrance) return r;
      // Cas isFrance : filtre stricte comme avant
      const allPeople = r.value.people;
      const frenchOnly = allPeople.filter(p => {
        const code = p.location?.country_code?.toUpperCase();
        const country = p.location?.country?.toLowerCase();
        // Accepte si pays France OU si FullEnrich n'a pas la donnee (null)
        if (!code && !country) return true;
        if (code === "FR") return true;
        if (country && /^france$|francaise?|french/i.test(country)) return true;
        return false;
      });
      const removed = allPeople.length - frenchOnly.length;
      if (removed > 0) {
        console.log(`[enrich-company] post-filter country=FR: -${removed} contacts non-FR retires (${allPeople.length} -> ${frenchOnly.length})`);
      }
      return { status: "fulfilled", value: { ...r.value, people: frenchOnly } };
    };
    personaResults = personaResults.map(filterByCountry);
  }

  // Credits epuises : FullEnrich renvoie 402 sur les /people/search. On
  // propage immediatement pour que le worker kill le job plutot que de
  // continuer a processer chaque signal pour rien (tous les appels suivants
  // echoueront pareil).
  for (const r of personaResults) {
    if (r.status === "rejected" && isCreditsExhaustedError(r.reason)) {
      throw r.reason;
    }
  }

  // Panne upstream (incident FullEnrich 504 du 2026-06-11 : 19/33 entreprises
  // sans contact, items pourtant marques completed → invisible et non
  // retryable). Si TOUTES les recherches personas ont echoue (HTTP 5xx,
  // timeout...), on throw pour que le worker marque l'item FAILED : visible
  // dans le compteur du job, et le signal reste re-enrichissable.
  // Le skip homonyme etranger reste un succes volontaire (0 credit consomme).
  // Un echec PARTIEL (au moins un persona OK) garde le comportement actuel :
  // on garde les contacts trouves.
  if (!skipForeignNamesake && personas.length > 0
      && personaResults.every((r) => r.status === "rejected")) {
    const firstReason = personaResults
      .map((r) => r.status === "rejected" ? errStr(r.reason) : "")
      .find(Boolean) ?? "unknown";
    throw new Error(`All ${personas.length} persona searches failed (${firstReason}) — item marked failed for retry`);
  }

  const isInternOrAlternant = (p: FullEnrichSearchPerson): boolean => {
    const t = (p.employment?.current?.title || "").toLowerCase();
    return /\b(alternant|alternante|stagiaire|apprenti|apprentie|intern|trainee)\b/i.test(t);
  };

  let fullenrichTotalProfiles = 0;
  let fullenrichRecruiterProfiles = 0;
  let feCreditsSearch = 0;

  // Wrapper : IA (Claude Haiku) en priorite, fallback regex si Claude
  // down ou pas de cle. Open-source ready : le role cible est defini
  // par des descriptions naturelles dans le persona.
  type FePeople = FullEnrichSearchPerson;
  const aiOrRegexFilter = async (
    people: FePeople[],
    persona: PersonaConfig,
  ): Promise<FePeople[]> => {
    if (people.length === 0) return [];
    const role = buildRoleDefinition(persona);
    if (!llm) {
      return people.filter(p => matchesPersonaTitle(p.employment?.current?.title, persona));
    }
    const candidates = people.map((p, idx) => ({
      idx,
      name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "unknown",
      title: p.employment?.current?.title || "",
    }));
    const aiResult = await validateCandidatesWithAI(llm, role, candidates);
    if (!aiResult) {
      console.log(`[enrich-company] AI validator unavailable for ${persona.slug}, falling back to matchesPersonaTitle`);
      return people.filter(p => matchesPersonaTitle(p.employment?.current?.title, persona));
    }
    const kept = people.filter((_, idx) => aiResult.validIndices.has(idx));
    const rejected = aiResult.details.filter(d => !d.match);
    console.log(
      `[enrich-company] AI validator ${persona.slug}: ${kept.length}/${people.length} kept` +
      (rejected.length > 0
        ? ` (rejected: ${rejected.slice(0, 3).map(r => `idx${r.idx}=${r.reason}`).join(", ")})`
        : "")
    );
    return kept;
  };

  // Pre-filter local (cheap) puis validation IA en PARALLELE de tous les personas.
  // Avant : 3 calls Claude sequentiels = 6-12s wall. Apres : Promise.all = 2-4s.
  // Reduction critique pour rester sous le runtime Supabase Edge (~50s CPU).
  const preFiltres = personaResults.map((r) =>
    r.status === "fulfilled"
      ? filterOutRecruiters(r.value.people).filter(p => !isInternOrAlternant(p))
      : []
  );

  for (let i = 0; i < personaResults.length; i++) {
    const r = personaResults[i];
    if (r.status === "fulfilled") {
      fullenrichTotalProfiles += r.value.people.length;
      fullenrichRecruiterProfiles += r.value.people.filter(p =>
        p.employment?.current?.title && /cabinet|agence|consultant.{0,3}recrutement/i.test(p.employment.current.title)
      ).length;
      feCreditsSearch += r.value.creditsUsed;
    }
  }

  // Filtre + cap (keep_cap) par persona, en parallele.
  const filteredByPersona = await Promise.all(
    personas.map(async (persona, i) => {
      const pre = preFiltres[i];
      const clean = await aiOrRegexFilter(pre, persona);
      const s = buildPersonaSearch(persona);
      const kept = s.keepCap != null ? clean.slice(0, s.keepCap) : clean;
      return { persona, people: kept, r: personaResults[i] };
    })
  );

  // Adoption des candidats par persona. On derive aussi more_available_counts
  // (combien de contacts restent disponibles au-dela de ce qu'on garde), pour le
  // bouton "voir plus" de l'UI. Cle = target_category legacy du persona (compat UI
  // Jay), fallback slug pour un workspace tiers ; bascule sur persona_id en PR4.
  const moreAvailable: Record<string, number> = {};
  for (const { persona, people, r } of filteredByPersona) {
    if (r.status === "fulfilled") {
      const totalAvailable = r.value.totalAvailable;
      moreAvailable[legacyTargetCategory(persona.slug) ?? persona.slug] =
        Math.max(0, (totalAvailable || 0) - people.length);
      console.log(
        `[enrich-company] FullEnrich ${persona.slug}: ${r.value.people.length}/${totalAvailable} found, ${people.length} kept`
      );
      for (const p of people) {
        const url = p.social_profiles?.professional_network?.url;
        if (url && usedLinkedInUrls.has(url)) continue;
        if (url) usedLinkedInUrls.add(url);
        adoptSearchPerson(p, persona);
      }
    } else {
      console.warn(`[enrich-company] FullEnrich ${persona.slug} search FAILED: ${errStr(r.reason)}`);
    }
  }

  const fullenrichRecruiterRatio = fullenrichTotalProfiles > 0
    ? fullenrichRecruiterProfiles / fullenrichTotalProfiles
    : 0;
  console.log(
    `[enrich-company] FullEnrich search totals: ${fullenrichTotalProfiles} profiles seen, ${feCreditsSearch.toFixed(2)} credits used`
  );

  // Fallback Brave (contacts hr/director) retire en PR3 : FullEnrich /people/search
  // + cascade geo suffisent, et un contact Brave (LinkedIn sans email) n'entre pas
  // dans le pipeline email-first (Bouncer -> Smartlead). Brave reste utilise ailleurs
  // (resolveur d'URL d'import plus haut, enrich social, google-news).

  // ─── 4. Detection cabinet de recrutement ─────────────────────────────────
  if (fullenrichRecruiterRatio >= 0.6) {
    console.log(`[enrich-company] DISMISS: "${companyName}" ressemble a un cabinet (${Math.round(fullenrichRecruiterRatio * 100)}% recruteurs)`);
    await supabase.from("prospect_signals").update({ status: "dismissed" }).eq("id", signalId);
    return {
      signal_id: signalId,
      company: companyName,
      company_group_id: companyGroupId,
      profiles_created: 0,
      emails_found: 0,
      dismissed_reason: "recruitment_agency_detected",
    };
  }

  // ─── 5. Parallel : FullEnrich bulk + Apify ────────────────────────────────
  // (inseePromise est demarre plus haut au step 2 pour la cascade geo, on
  // la reutilise plus bas pour les details d'adresse / siren / sector.)

  let emailsFound = 0;
  // On ne demande que contact.work_emails a FullEnrich (cf fullenrich.ts) —
  // les phones coutent ~10x plus cher et Alex ne contacte pas par telephone.
  // → pas de champ `phone` dans le delta.
  const deltas = new Map<number, {
    email?: string;
    email_source?: EmailSource | null;
    fullenrich_profile?: Record<string, unknown>;
  }>();

  // Bulk enrich uniquement ceux avec linkedin_url : hit rate ~95% vs ~50%
  // sans URL (source: FullEnrich docs). Les quelques profils Brave sans URL
  // qui passent le filtre strict sont laisses sans email plutot que de cramer
  // 1 credit par miss. L'utilisateur peut les contacter via LinkedIn directement.
  const enrichableFE = profileQueue.filter(item => !!item.profile_data.linkedin_url);
  const feContacts: FullEnrichContactInput[] = enrichableFE.map((item) => ({
    first_name: item.profile_data.first_name || undefined,
    last_name: item.profile_data.last_name || undefined,
    company_name: item.profile_data.company_name || undefined,
    linkedin_url: item.profile_data.linkedin_url || undefined,
    enrich_fields: ["contact.work_emails"],
    custom: { contact_key: `p_${profileQueue.indexOf(item)}` },
  }));

  async function runFullEnrichBulk(): Promise<void> {
    if (feContacts.length === 0) return;
    const jobStart = Date.now();
    console.log(`[enrich-company] FullEnrich bulk: ${feContacts.length} contacts`);
    try {
      const webhookUrl = buildFullenrichWebhookUrl();
      // 2026-05-21 : timeout bulk FullEnrich pour empecher les workers zombies.
      // Si le polling depasse searchTimeoutMs, on abandonne (resultsByKey vide)
      // et le worker termine sans crasher.
      const bulkPromise = enrichContactsViaFullEnrich(
        fullenrichKey!,
        `enrich-company-${companyName}-${Date.now()}`,
        feContacts,
        {
          webhookUrl: webhookUrl ?? undefined,
          buildCheckWebhook: webhookUrl
            ? (enrichmentId) => buildCheckWebhook(supabase, enrichmentId)
            : undefined,
          dedupContext: { supabase, companyName },
        },
      );
      const timeoutMs = searchTimeoutMs > 0 ? searchTimeoutMs : 120_000;
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const raceResult = await Promise.race([bulkPromise, timeoutPromise]);
      if (raceResult === null) {
        console.warn(`[enrich-company] FullEnrich bulk TIMED OUT after ${timeoutMs / 1000}s on "${companyName}" — skipping bulk results`);
        return;
      }
      const { resultsByKey, creditsUsed, id } = raceResult;
      console.log(
        `[enrich-company] FullEnrich bulk done in ${Math.round((Date.now() - jobStart) / 1000)}s ` +
        `(id=${id}, ${creditsUsed} credits, ${resultsByKey.size} results)`
      );

      for (const item of enrichableFE) {
        const idx = profileQueue.indexOf(item);
        const result: FullEnrichContactResult | undefined = resultsByKey.get(`p_${idx}`);
        if (!result) continue;

        const { email, source } = pickBestEmailWithSource(result);
        console.log(
          `[enrich-company] FullEnrich ${item.profile_data.first_name} ${item.profile_data.last_name}` +
          ` → email=${email ? `FOUND (${source})` : "null"}`
        );

        const delta = deltas.get(idx) || {};
        if (email) {
          delta.email = email;
          delta.email_source = source;

          if (item.profile_id) {
            await logEmailGenerated(supabase, {
              prospect_id: item.profile_id,
              email,
              email_source: source ?? "fullenrich",
              fullenrich_status: source === "fullenrich" ? (result.contact_info?.most_probable_work_email?.status ?? null) : null,
            });
          }
        }

        const p = result.profile;
        if (p) {
          delta.fullenrich_profile = {
            current_title: p.employment?.current?.title,
            current_company: p.employment?.current?.company?.name,
            current_company_headcount: p.employment?.current?.company?.headcount,
            current_company_description: p.employment?.current?.company?.description,
            city: p.location?.city,
            country: p.location?.country,
            skills: (p.skills || []).slice(0, 8),
            languages: (p.languages || []).map(l => l.language).filter(Boolean).slice(0, 4),
          };
        }
        deltas.set(idx, delta);
      }
    } catch (err) {
      // Credits epuises sur le bulk : on propage pour que le worker kill
      // le job. Autres erreurs : on degrade gracieusement (pas d'emails).
      if (isCreditsExhaustedError(err)) {
        throw err;
      }
      console.warn(`[enrich-company] FullEnrich bulk FAILED (proceeding without emails): ${errStr(err)}`);
    }
  }

  // Apify scrape retire 19/05 : LinkedIn URL deja recupere via FE
  // /people/search (social_profiles.professional_network.url). Le snapshot
  // deep (headline, about, experiences) n'est plus utilise downstream depuis
  // le switch templates determinist 24/04 (cf [[prospection-messages-deterministic]]).
  // Refresh ponctuel via refresh-prospect-linkedin-snapshots si besoin.

  if (profileQueue.length > 0) {
    const enrichStart = Date.now();
    await runFullEnrichBulk();
    console.log(`[enrich-company] Bulk enrich done in ${Math.round((Date.now() - enrichStart) / 1000)}s`);

    for (const [idx, delta] of deltas.entries()) {
      const item = profileQueue[idx];
      if (!item) continue;
      if (delta.email && !item.profile_data.email) {
        item.profile_data.email = delta.email;
        item.profile_data.email_source = delta.email_source ?? "fullenrich";
        emailsFound++;
      }
      if (delta.fullenrich_profile) {
        const existing = (item.profile_data.enrichment_data as Record<string, unknown> | undefined) || {};
        item.profile_data.enrichment_data = {
          ...existing,
          fullenrich_profile: delta.fullenrich_profile,
        };
      }

      // Reconstruction des noms : LinkedIn anonymise parfois le nom de famille
      // ("Marie W."), et le scraper le stocke tel quel. Si l'email contient
      // le nom complet (prenom.nom@), on backfill pour eviter "Bonjour Marie W.".
      // Capitalise aussi les noms ALL CAPS (cosmetique).
      const reco = reconstructNameFromEmail(
        item.profile_data.first_name,
        item.profile_data.last_name,
        item.profile_data.email,
      );
      if (reco.changed) {
        console.log(`[enrich-company] Name normalized: "${item.profile_data.first_name} ${item.profile_data.last_name}" -> "${reco.firstName} ${reco.lastName}"`);
        item.profile_data.first_name = reco.firstName;
        item.profile_data.last_name = reco.lastName;
      }
    }

    // ─── 5b. MAJ domain_email_patterns ─────────────────────────────────────
    // Pour chaque domaine ou on a >=3 emails (en combinant ce qu'on vient
    // d'enrichir + ce qui est deja en base), on calcule le pattern dominant
    // et on upsert dans domain_email_patterns. Servira aux deductions futures
    // (cf enrich-deduced-emails edge function).
    await updateDomainPatternsFromQueue(supabase, profileQueue);
  }

  // ─── 6. INSEE fallback pour adresse postale ──────────────────────────────
  let sharedEnrichment = profileQueue
    .map(p => p.profile_data.enrichment_data as Record<string, unknown> | undefined)
    .find(e => e?.company_address);

  if (!sharedEnrichment?.company_address) {
    console.log(`[enrich-company] Awaiting INSEE for "${companyName}"`);
    const sirene = await inseePromise;
    if (sirene?.address) {
      console.log(`[enrich-company] INSEE MATCH: ${sirene.name || companyName} — siren=${sirene.siren} address=${sirene.address}`);
      sharedEnrichment = {
        ...(sharedEnrichment || {}),
        company_address: sirene.address,
        company_zip: sirene.zip,
        company_city: sirene.city,
        company_country: "France", // marché-FR : atteint uniquement si SIRENE a matché (gate isFrance plus haut)
      };
      for (const item of profileQueue) {
        if (!item.profile_data.company_siren && sirene.siren) item.profile_data.company_siren = sirene.siren;
        if (!item.profile_data.company_sector && sirene.naf_label) item.profile_data.company_sector = sirene.naf_label;
        if (!item.profile_data.company_city && sirene.city) item.profile_data.company_city = sirene.city;
        if (!item.profile_data.company_size && sirene.employees_range) item.profile_data.company_size = sirene.employees_range;
      }
    } else {
      console.log(`[enrich-company] INSEE no match for "${companyName}"`);
    }
  }

  if (sharedEnrichment) {
    for (const item of profileQueue) {
      const existing = (item.profile_data.enrichment_data as Record<string, unknown> | undefined) || {};
      item.profile_data.enrichment_data = { ...sharedEnrichment, ...existing };
    }
  }

  // ─── 7. Dedup + insert + update signal + trigger messages ────────────────
  let profilesToInsert = profileQueue.map((item) => item.profile_data);
  let duplicateProfiles = 0;

  if (existingGroup && profilesToInsert.length > 0) {
    const { data: existing } = await supabase
      .from("prospect_profiles")
      .select("linkedin_url, first_name, last_name")
      .eq("company_group_id", companyGroupId);

    const existingLinkedIn = new Set(
      (existing || []).map(p => (p.linkedin_url || "").toLowerCase().replace(/\/$/, "")).filter(Boolean)
    );
    const existingNames = new Set(
      (existing || []).map(p =>
        `${(p.first_name || "").toLowerCase().trim()} ${(p.last_name || "").toLowerCase().trim()}`.trim()
      )
    );

    profilesToInsert = profilesToInsert.filter(p => {
      const url = (p.linkedin_url || "").toLowerCase().replace(/\/$/, "");
      const nameKey = `${(p.first_name || "").toLowerCase().trim()} ${(p.last_name || "").toLowerCase().trim()}`.trim();
      const isDupe = (url && existingLinkedIn.has(url)) || (nameKey && existingNames.has(nameKey));
      if (isDupe) {
        duplicateProfiles++;
        console.log(`[enrich-company] SKIP duplicate: ${p.first_name} ${p.last_name} already in group`);
      }
      return !isDupe;
    });
  }

  console.log(`[enrich-company] Inserting ${profilesToInsert.length} profiles (${duplicateProfiles} doublons retires)`);

  if (profilesToInsert.length > 0) {
    // Multi-tenant : workspace_id du signal + persona_id deja dans profile_data
    const withWorkspace = profilesToInsert.map((p) => ({
      ...p,
      workspace_id: workspaceId,
      more_available_counts: moreAvailable,
    }));

    const { error: insertError } = await supabase.from("prospect_profiles").insert(withWorkspace);
    if (insertError) {
      throw new Error(`Failed to insert profiles: ${insertError.message}`);
    }
  }

  console.log(`[enrich-company] Marking signal as matched`);
  const { error: updateError } = await supabase
    .from("prospect_signals").update({ status: "matched" }).eq("id", signalId);
  if (updateError) {
    console.warn(`[enrich-company] Failed to update signal status: ${updateError.message}`);
  }

  if (profilesToInsert.length > 0) {
    try {
      const { data: adminProfiles } = await supabase
        .from("profiles").select("id").eq("role", "admin").limit(1);
      const adminUserId = adminProfiles?.[0]?.id || null;

      const msgRes = await fetch(`${ctx.functionsUrl}/generate-prospect-messages-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ctx.serviceRoleKey}`,
        },
        body: JSON.stringify({
          mode: "submit-batch",
          company_group_id: companyGroupId,
          user_id: adminUserId,
        }),
      });
      const msgData = await msgRes.json();
      console.log(`[enrich-company] Messages batch submitted: ${msgData.batch_id || "n/a"} (${msgData.total || 0} msgs)`);
    } catch (msgErr) {
      console.warn(`[enrich-company] Messages batch submission failed: ${errStr(msgErr)}`);
    }
  }

  // Fire-and-forget detection CRM. Tourne en parallele de la generation de messages
  // (que la generation ait commence avant ou apres detect-crm n'importe pas :
  // la generation lit la detection CRM au moment du build du prompt).
  // Si Apify echoue ou que le scrape time out, le cron cleanup-stuck-crm-detections
  // marquera la row failed apres 5 min - non bloquant.
  fetch(`${ctx.functionsUrl}/detect-crm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ctx.serviceRoleKey}`,
    },
    body: JSON.stringify({ company_group_id: companyGroupId }),
  }).catch((err) => {
    console.warn(`[enrich-company] detect-crm fire-and-forget failed: ${errStr(err)}`);
  });

  // Fire-and-forget Bouncer verification : vérifie les emails fraichement enrichis
  // de cette entreprise pour mettre à jour bouncer_status. Pas besoin d'attendre.
  if (profilesToInsert.length > 0) {
    fetch(`${ctx.functionsUrl}/bouncer-batch?company_group_id=${companyGroupId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ctx.serviceRoleKey}`,
      },
      body: "{}",
    }).catch((err) => {
      console.warn(`[enrich-company] bouncer-batch fire-and-forget failed: ${errStr(err)}`);
    });
  }

  return {
    signal_id: signalId,
    company: companyName,
    company_group_id: companyGroupId,
    profiles_created: profileQueue.length,
    emails_found: emailsFound,
  };
}

function errStr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

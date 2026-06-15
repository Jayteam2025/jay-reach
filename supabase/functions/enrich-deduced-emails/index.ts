import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";
import {
  buildEmail,
  type PatternId,
} from "../_shared/email-pattern.ts";
import {
  classifyReoonResult,
  ReoonError,
  verifyEmail,
} from "../_shared/reoon.ts";
import { logEmailGenerated } from "../_shared/audit-events.ts";
import { resolveProviderForDefaultWorkspace } from "../_shared/providers/registry.ts";

/**
 * enrich-deduced-emails
 *
 * Pour chaque profil sans email dont le domaine a un pattern enregistre :
 *   - tier=high   -> email deduit + status="deduced_high" (display direct,
 *                    pas de Reoon)
 *   - tier=medium -> email deduit + verif Reoon
 *                      - si valid     -> status="verified"
 *                      - si catch_all -> domaine note catch-all, status="deduced_unverified"
 *                      - si invalid   -> on n'ecrit pas l'email
 *                      - si Reoon plein (cap 20/jour) -> status="deduced_unverified"
 *                        (fallback : on affiche quand meme l'email deduit)
 *
 * Modes d'invocation :
 *   - Cron quotidien (matin) : drain de tous les profils en attente
 *   - On-demand POST { company_group_id } : restreint a un group precis
 *
 * Auth :
 *   - cron       : Authorization: Bearer <CRON_SECRET>
 *   - service    : Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   - user admin : Authorization: Bearer <user JWT> (verif role=admin)
 */

interface ProfileWithDomain {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  email_validation_status: string | null;
}

interface DomainPattern {
  domain: string;
  pattern: PatternId;
  tier: "high" | "medium";
  confidence: number;
}

const EnrichDeducedEmailsRequestSchema = z.object({
  company_group_id: z.string().optional(),
}).passthrough();

const MAX_PROFILES_PER_RUN = 200;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Clé Reoon résolue via le provider validator (BDD chiffrée d'abord, fallback env) —
  // plus de REOON_API_KEY lue en dur (modèle self-host : clé saisie dans l'UI Providers).
  let reoonKey: string;
  try {
    const reoonProvider = await resolveProviderForDefaultWorkspace(supabase, "validator", { providerType: "reoon" });
    reoonKey = reoonProvider.apiKey;
  } catch (err) {
    console.error("[enrich-deduced-emails] clé Reoon non résolue:", err);
    return new Response(
      JSON.stringify({ error: "Reoon validator not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isService = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCron && !isService) {
    const { userId, error: authErr } = await extractUserId(supabase, req);
    if (authErr || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ─── Body parse (optionnel) ────────────────────────────────────────────────
  let companyGroupId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const _validation = validateOrRespond(
        EnrichDeducedEmailsRequestSchema,
        body,
        corsHeaders,
        "strict",
        { functionName: "enrich-deduced-emails" }
      );
      if (_validation.response) return _validation.response;
      if (_validation.data.company_group_id) companyGroupId = String(_validation.data.company_group_id);
    } catch { /* ignore */ }
  }

  const startedAt = Date.now();

  // ─── 1. Recupere les patterns valides (high + medium) ─────────────────────
  const { data: patternsRaw, error: patternsErr } = await supabase
    .from("domain_email_patterns")
    .select("domain, pattern, tier")
    .in("tier", ["high", "medium"]);

  if (patternsErr) {
    return new Response(
      JSON.stringify({ error: `patterns fetch failed: ${patternsErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const patterns = new Map<string, DomainPattern>(
    (patternsRaw || []).map(p => [p.domain, p as DomainPattern]),
  );
  if (patterns.size === 0) {
    return new Response(
      JSON.stringify({ ok: true, message: "No domain patterns yet, nothing to deduce", deduced: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ─── 2. Recupere les domaines catch-all (skip toute deduction dessus) ─────
  const { data: catchAlls } = await supabase
    .from("catch_all_domains")
    .select("domain");
  const catchAllSet = new Set((catchAlls || []).map(d => d.domain));

  // ─── 3. Recupere les profils sans email candidats a la deduction ──────────
  // Critere : email vide OU email_validation_status='unverified', avec
  // first_name + last_name + company_name renseignes.
  let query = supabase
    .from("prospect_profiles")
    .select("id, first_name, last_name, company_name, email, email_validation_status")
    .is("email", null)
    .not("first_name", "is", null)
    .not("last_name", "is", null)
    .not("company_name", "is", null)
    .is("deleted_at", null)
    .limit(MAX_PROFILES_PER_RUN);
  if (companyGroupId) {
    query = query.eq("company_group_id", companyGroupId);
  }
  const { data: profiles, error: profilesErr } = await query;

  if (profilesErr) {
    return new Response(
      JSON.stringify({ error: `profiles fetch failed: ${profilesErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!profiles || profiles.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, message: "No profiles need deduction", deduced: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ─── 4. Determine le domaine par profil (via les emails connus du group) ──
  // On groupe les profils par company_name puis on cherche le domaine le plus
  // frequent parmi les emails connus de cette boite.
  const companyToDomain = new Map<string, string>();
  const companies = new Set<string>(profiles.map(p => p.company_name!).filter(Boolean));

  for (const company of companies) {
    const { data: knownEmails } = await supabase
      .from("prospect_profiles")
      .select("email")
      .eq("company_name", company)
      .not("email", "is", null)
      .is("deleted_at", null)
      .limit(50);

    if (!knownEmails || knownEmails.length === 0) continue;

    const domainCounts = new Map<string, number>();
    for (const row of knownEmails) {
      const domain = row.email?.split("@")[1]?.toLowerCase();
      if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }

    const sortedDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedDomains.length > 0) {
      companyToDomain.set(company, sortedDomains[0][0]);
    }
  }

  // ─── 5. Boucle sur les profils, deduction + verif eventuelle ──────────────
  const results = {
    deduced_high: 0,
    deduced_medium_verified: 0,
    deduced_unverified: 0,
    skipped_no_pattern: 0,
    skipped_catch_all: 0,
    skipped_invalid: 0,
    reoon_calls: 0,
    reoon_quota_hits: 0,
  };

  for (const profile of profiles as ProfileWithDomain[]) {
    if (!profile.company_name) continue;
    const domain = companyToDomain.get(profile.company_name);
    if (!domain) {
      results.skipped_no_pattern++;
      continue;
    }
    if (catchAllSet.has(domain)) {
      results.skipped_catch_all++;
      continue;
    }
    const pat = patterns.get(domain);
    if (!pat) {
      results.skipped_no_pattern++;
      continue;
    }

    const deducedEmail = buildEmail(pat.pattern, profile.first_name, profile.last_name, domain);
    if (!deducedEmail) {
      results.skipped_no_pattern++;
      continue;
    }

    let finalStatus: "verified" | "deduced_high" | "deduced_unverified" = "deduced_unverified";

    if (pat.tier === "high") {
      // Pattern HIGH : on fait confiance, pas de Reoon
      finalStatus = "deduced_high";
      results.deduced_high++;
    } else {
      // Pattern MEDIUM : on tente la verif Reoon (si quota dispo)
      const { data: quotaOk, error: quotaErr } = await supabase.rpc("consume_reoon_credit", { p_count: 1 });

      if (quotaErr || !quotaOk) {
        // Cap atteint : fallback display sans verif
        results.reoon_quota_hits++;
        finalStatus = "deduced_unverified";
        results.deduced_unverified++;
      } else {
        results.reoon_calls++;
        try {
          const reoon = await verifyEmail(reoonKey, deducedEmail, "power");
          const cls = classifyReoonResult(reoon);

          // Cache le resultat (TTL implicite par checked_at)
          await supabase.from("email_verification_cache").upsert({
            email: deducedEmail,
            status: cls,
            source: "reoon",
            reoon_raw: reoon,
            checked_at: new Date().toISOString(),
          });

          if (cls === "valid") {
            finalStatus = "verified";
            results.deduced_medium_verified++;
          } else if (cls === "catch_all") {
            // Domaine catch-all detecte : on memorise + display sans verif
            await supabase.from("catch_all_domains").upsert({
              domain,
              detected_at: new Date().toISOString(),
              reoon_raw: reoon,
            });
            finalStatus = "deduced_unverified";
            results.deduced_unverified++;
          } else if (cls === "invalid") {
            // Email n'existe pas : on n'ecrit pas dans prospect_profiles
            results.skipped_invalid++;
            continue;
          } else {
            // unknown -> fallback unverified
            finalStatus = "deduced_unverified";
            results.deduced_unverified++;
          }
        } catch (err) {
          if (err instanceof ReoonError) {
            console.warn(`[enrich-deduced-emails] Reoon error for ${deducedEmail}: ${err.message}`);
            finalStatus = "deduced_unverified";
            results.deduced_unverified++;
          } else {
            throw err;
          }
        }
      }
    }

    // Update profile
    const { error: updateErr } = await supabase
      .from("prospect_profiles")
      .update({
        email: deducedEmail,
        email_validation_status: finalStatus,
        email_source: "deduced",
      })
      .eq("id", profile.id);

    if (updateErr) {
      console.warn(`[enrich-deduced-emails] update failed for profile ${profile.id}: ${updateErr.message}`);
    } else {
      // Log audit event
      await logEmailGenerated(supabase, {
        prospect_id: profile.id,
        email: deducedEmail,
        email_source: "deduced",
        pattern_id: pat.pattern,
        pattern_confidence: pat.confidence ?? null,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[enrich-deduced-emails] done in ${elapsedMs}ms — high=${results.deduced_high}, medium_verified=${results.deduced_medium_verified}, unverified=${results.deduced_unverified}, skipped_no_pattern=${results.skipped_no_pattern}, skipped_catch_all=${results.skipped_catch_all}, skipped_invalid=${results.skipped_invalid}, reoon_calls=${results.reoon_calls}, quota_hits=${results.reoon_quota_hits}`,
  );

  // Fire-and-forget Bouncer verification : si des emails ont ete deduits sur cette entreprise,
  // on lance bouncer-batch pour avoir le bouncer_status a jour. Pas besoin d'attendre.
  const totalDeduced = results.deduced_high + results.deduced_medium_verified + results.deduced_unverified;
  if (companyGroupId && totalDeduced > 0) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      fetch(`${supabaseUrl}/functions/v1/bouncer-batch?company_group_id=${companyGroupId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: "{}",
      }).catch((err) => {
        console.warn(`[enrich-deduced-emails] bouncer-batch fire-and-forget failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, elapsed_ms: elapsedMs, processed: profiles.length, ...results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";
import { ApifyLinkedInProfileScraper } from "../_shared/apify-linkedin-profile.ts";

/**
 * refresh-prospect-linkedin-snapshots
 *
 * Re-enrichit les prospect_profiles existants avec un snapshot Apify
 * LinkedIn (headline, about, current position, previous positions,
 * location). Utile pour les profils enrichis avant le deploiement
 * d'Apify dans enrich-company.
 *
 * Modes :
 * - GET/POST sans body : batch tous les profils sans enrichment_data.linkedin
 * - POST { company_group_id: "..." } : limite a une entreprise
 * - POST { only_missing: false } : re-scrape tout (useful pour refresh periodique)
 *
 * Auth : admin only.
 */

interface ProfileRow {
  id: string;
  linkedin_url: string | null;
  email: string | null;
  enrichment_data: Record<string, unknown> | null;
  first_name: string;
  last_name: string;
  company_name: string;
}

const RefreshLinkedInSnapshotsRequestSchema = z.object({
  company_group_id: z.string().optional(),
  only_missing: z.boolean().optional(),
}).passthrough();

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Accept three auth modes : CRON_SECRET (ops trigger), service_role
  // (internal), ou JWT admin user.
  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCronCall && !isServiceRole) {
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
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
        headers: corsHeaders,
      });
    }
  }

  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  if (!apifyToken) {
    return new Response(
      JSON.stringify({ error: "APIFY_API_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse options
  let companyGroupId: string | undefined;
  let onlyMissing = true;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const _validation = validateOrRespond(
        RefreshLinkedInSnapshotsRequestSchema,
        body,
        corsHeaders,
        "strict",
        { functionName: "refresh-prospect-linkedin-snapshots" }
      );
      if (_validation.response) return _validation.response;
      companyGroupId = _validation.data.company_group_id;
      if (typeof _validation.data.only_missing === "boolean") onlyMissing = _validation.data.only_missing;
    } catch {
      // empty body is fine
    }
  }

  // Fetch profiles to refresh
  let query = supabase
    .from("prospect_profiles")
    .select("id, linkedin_url, email, enrichment_data, first_name, last_name, company_name")
    .not("linkedin_url", "is", null);

  if (companyGroupId) {
    query = query.eq("company_group_id", companyGroupId);
  }

  const { data: profiles, error: fetchErr } = await query;
  if (fetchErr) {
    return new Response(
      JSON.stringify({ error: `Fetch failed: ${fetchErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const candidates = (profiles || []).filter((p) => {
    if (!onlyMissing) return true;
    const enrichment = (p.enrichment_data as Record<string, unknown> | null) || {};
    return !enrichment.linkedin;
  }) as ProfileRow[];

  if (candidates.length === 0) {
    return new Response(
      JSON.stringify({ updated: 0, message: "No profiles to refresh" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(
    `[refresh-prospect-linkedin-snapshots] Refreshing ${candidates.length} profiles (only_missing=${onlyMissing})`
  );

  // Batch Apify — mode "with email" pour essayer de completer les emails
  // manquants (SMTP-validate, pas de guess). Cout 0.010$/profile.
  const scraper = new ApifyLinkedInProfileScraper(apifyToken, { withEmail: true });
  const BATCH_SIZE = 20;
  let updated = 0;
  let failed = 0;
  let emailsFoundFromApify = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const urls = batch.map((p) => p.linkedin_url!);

    console.log(
      `[refresh-prospect-linkedin-snapshots] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${urls.length} URLs`
    );

    const results = await scraper.scrapeByUrls(urls);

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const data = results[j];
      if (!data) {
        failed++;
        continue;
      }

      const snapshot = {
        headline: data.headline,
        about: data.about,
        current_title: data.currentPosition?.title,
        current_company: data.currentPosition?.company,
        current_description: data.currentPosition?.description,
        location: data.location,
        previous_positions: (data.previousPositions || []).slice(0, 3).map((p) => ({
          title: p.title,
          company: p.company,
          years: p.years,
        })),
      };

      const existing = (item.enrichment_data as Record<string, unknown> | null) || {};
      const newEnrichment = { ...existing, linkedin: snapshot };

      // Fallback email : si Apify retourne un email et que le profil n'en
      // a pas, on remplit — permet de capter les emails qui ne passent pas
      // par FullEnrich.
      const updatePayload: Record<string, unknown> = { enrichment_data: newEnrichment };
      if (data.email && !item.email) {
        updatePayload.email = data.email;
        emailsFoundFromApify++;
        console.log(
          `[refresh-prospect-linkedin-snapshots] Apify email HIT: ${item.first_name} ${item.last_name} → ${data.email}`
        );
      }

      const { error: updateErr } = await supabase
        .from("prospect_profiles")
        .update(updatePayload)
        .eq("id", item.id);

      if (updateErr) {
        console.warn(
          `[refresh-prospect-linkedin-snapshots] Update failed for ${item.id}: ${updateErr.message}`
        );
        failed++;
      } else {
        updated++;
        console.log(
          `[refresh-prospect-linkedin-snapshots] HIT: ${item.first_name} ${item.last_name} @ ${item.company_name} — ${data.headline || data.currentPosition?.title || "no headline"}`
        );
      }
    }
  }

  return new Response(
    JSON.stringify({
      total_candidates: candidates.length,
      updated,
      failed,
      emails_found: emailsFoundFromApify,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

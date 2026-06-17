import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveEnricherForDefaultWorkspace } from "../_shared/providers/registry.ts";
import { loadActivePersonas } from "../_shared/workspace-config.ts";
import { buildPersonaSearch, matchesPersonaTitle } from "../_shared/persona-enrichment-core.ts";
import type { PersonaConfig } from "../_shared/workspace-config-core.ts";
import {
  searchContactsAtCompanyCascade,
  filterOutRecruiters,
  enrichContactsViaFullEnrich,
  pickBestEmailWithSource,
  type EmailSource,
  type FullEnrichContactInput,
  type FullEnrichSearchPerson,
  type SearchFilter,
} from "../_shared/fullenrich.ts";
import { buildGeoCascade, stripGeoSuffix } from "../_shared/geo-cascade.ts";
import { findCompanyByName } from "../_shared/insee-sirene.ts";
import { buildCheckWebhook, buildFullenrichWebhookUrl } from "../_shared/fullenrich-webhook-helpers.ts";
import { logEmailGenerated } from "../_shared/audit-events.ts";
import { z } from "npm:zod@3.24.1";

/**
 * expand-prospect-profiles
 *
 * Appelee depuis la fiche entreprise quand l'operateur clique "Voir 10 de plus" sur
 * un persona (RH / Dir Co / Commerciaux). Relance un search FullEnrich
 * sur le meme persona, skip les LinkedIn URL deja en DB, insere les nouveaux
 * profils et lance leur enrichment bulk (work_email uniquement, pas de phone).
 *
 * Input : { company_group_id: string, persona_id?: string, category?: 'hr'|'director'|'field_sales', count?: number }
 *   - persona_id OU category requis (au moins un). La transition envoie encore category.
 *   - count par defaut = 10. Max 50 par appel pour proteger les credits.
 *
 * Output : { inserted: number, more_available_counts: {...}, credits_used }
 */

// Validation Zod de la request (persona_id-based uniquement).
// company_group_id non vide + persona_id requis.
// count optionnel et clampe 1..50 (default 10).
const ExpandRequestSchema = z.object({
  company_group_id: z.string().min(1),
  persona_id: z.string().min(1),
  count: z.number().optional(),
});

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCronCall = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCronCall && !isServiceRole) {
    const { userId, error: authError } = await extractUserId(supabase, req);
    if (authError || !userId) {
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

  const parsed = ExpandRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "company_group_id and persona_id required", details: parsed.error.flatten() }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const { company_group_id, persona_id } = parsed.data;
  const count = Math.min(Math.max(parsed.data.count ?? 10, 1), 50);

  let fullenrichKey: string;
  try {
    const { context } = await resolveEnricherForDefaultWorkspace(supabase);
    fullenrichKey = context.apiKey;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `FullEnrich provider not configured: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 1. Recupere les profils existants du group pour dedup + adresse
  const { data: existingProfiles, error: fetchErr } = await supabase
    .from("prospect_profiles")
    .select("id, first_name, last_name, linkedin_url, company_name, source_signal_id, company_city, enrichment_data, workspace_id")
    .eq("company_group_id", company_group_id);

  if (fetchErr || !existingProfiles || existingProfiles.length === 0) {
    return new Response(
      JSON.stringify({ error: "company_group not found or empty" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const companyName = existingProfiles[0].company_name;
  const sourceSignalId = existingProfiles[0].source_signal_id;
  const workspaceId = existingProfiles[0].workspace_id as string;
  if (!workspaceId) {
    return new Response(
      JSON.stringify({ error: "company_group has no workspace_id" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Résout le persona depuis persona_id ou category (compat transition)
  let personas: PersonaConfig[];
  try {
    personas = await loadActivePersonas(supabase, workspaceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Cannot load personas: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const persona = personas.find(p => p.id === persona_id);
  if (!persona) {
    return new Response(
      JSON.stringify({ error: `Persona not found (persona_id=${persona_id})` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const existingUrls = new Set<string>(
    existingProfiles
      .map((p) => (p.linkedin_url || "").toLowerCase().replace(/\/+$/, ""))
      .filter(Boolean)
  );
  const existingNames = new Set<string>(
    existingProfiles.map((p) =>
      `${(p.first_name || "").toLowerCase().trim()} ${(p.last_name || "").toLowerCase().trim()}`.trim()
    )
  );

  // 2. Construit la cascade geo a partir de l'adresse company.
  //    On lit d'abord ce qui est deja en base (rempli par enrich-company via
  //    INSEE), avec fallback INSEE si l'adresse n'a pas ete persisted.
  let cityForCascade = existingProfiles[0].company_city as string | null;
  let zipForCascade: string | null = null;
  for (const p of existingProfiles) {
    const enr = p.enrichment_data as Record<string, unknown> | null;
    if (enr?.company_zip) {
      zipForCascade = String(enr.company_zip);
      if (!cityForCascade && enr.company_city) cityForCascade = String(enr.company_city);
      break;
    }
  }
  if (!cityForCascade && !zipForCascade) {
    // Fallback INSEE (timeout 1.5s pour pas bloquer trop longtemps)
    const sirene = await Promise.race([
      findCompanyByName(companyName).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (sirene) {
      cityForCascade = sirene.city;
      zipForCascade = sirene.zip;
    }
  }
  const geoCascade = buildGeoCascade({ city: cityForCascade, postalCode: zipForCascade });
  console.log(
    `[expand-prospect-profiles] Geo cascade for "${companyName}" (persona=${persona.slug}): ${geoCascade.map(g => g.value).join(" -> ")}`
  );

  // 3. Search FullEnrich en cascade (ville -> dept -> region -> pays).
  //    Plafond large pour couvrir les URLs deja consommees (dedup).
  const s = buildPersonaSearch(persona);
  // Variante geo-strippee : "IDEA Nouvelle Aquitaine" -> "IDEA". Cf rationale
  // dans enrich-company/index.ts (filiales regionales = nom court sur LinkedIn).
  const companyNamesFilter: SearchFilter[] = [{ value: companyName, exact_match: true }];
  const strippedName = stripGeoSuffix(companyName);
  if (strippedName && strippedName.toLowerCase() !== companyName.toLowerCase()) {
    companyNamesFilter.push({ value: strippedName, exact_match: true });
    console.log(`[expand-prospect-profiles] companyFilter added geo-stripped: "${strippedName}"`);
  }
  const cascadeRes = await searchContactsAtCompanyCascade(
    fullenrichKey,
    {
      companyNames: companyNamesFilter,
      positionTitles: s.positionTitles,
      seniorityLevels: s.seniorityLevels,
      // On demande jusqu'a (profils_dejA + count * 2) pour etre sur d'avoir
      // `count` nouveaux apres dedup. Plafond 200.
      maxContacts: Math.min(200, Math.max(existingProfiles.length + count * 2, s.maxContacts)),
    },
    geoCascade,
    1,
  );
  const { people: found, totalAvailable, creditsUsed: searchCredits } = cascadeRes;
  console.log(
    `[expand-prospect-profiles] cascade stop="${cascadeRes.stoppedAtValue || "(rien)"}" (level=${cascadeRes.stoppedAtLevel}), ${found.length} contacts, ${searchCredits.toFixed(2)} credits`
  );

  // 3. Filtre recruteurs + dedup vs existant
  const cleaned = filterOutRecruiters(found);
  const newPeople: FullEnrichSearchPerson[] = [];
  for (const p of cleaned) {
    if (newPeople.length >= count) break;
    const url = (p.social_profiles?.professional_network?.url || "").toLowerCase().replace(/\/+$/, "");
    const nameKey = `${(p.first_name || "").toLowerCase().trim()} ${(p.last_name || "").toLowerCase().trim()}`.trim();
    if (url && existingUrls.has(url)) continue;
    if (nameKey && existingNames.has(nameKey)) continue;
    newPeople.push(p);
    if (url) existingUrls.add(url);
    if (nameKey) existingNames.add(nameKey);
  }

  console.log(
    `[expand-prospect-profiles] ${persona.slug} for "${companyName}": ${found.length} found / ${totalAvailable} available, ${newPeople.length} new after dedup`
  );

  // Filtre persona : pour les personas cast_wide (ex. director sans positionTitles),
  // narrow les résultats larges aux bons profils via job_title_keywords.
  // Les personas by_titles ont déjà filtré en cascade, donc ce filtre est peu
  // restrictif pour eux (match sur les positionTitles deja demandées).
  const personaFiltered = newPeople.filter(p => matchesPersonaTitle(p.employment?.current?.title, persona));
  console.log(
    `[expand-prospect-profiles] ${persona.slug}: ${newPeople.length} after dedup -> ${personaFiltered.length} after persona filter`
  );

  if (personaFiltered.length === 0) {
    return new Response(
      JSON.stringify({
        inserted: 0,
        more_available_counts: null,
        credits_used: searchCredits,
        message: "Aucun nouveau contact disponible",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 4. Enrichment bulk (work_emails uniquement, pas de phone pour economiser les credits)
  const enrichInputs: FullEnrichContactInput[] = personaFiltered.map((p, idx) => ({
    first_name: p.first_name,
    last_name: p.last_name,
    company_name: companyName,
    linkedin_url: p.social_profiles?.professional_network?.url,
    enrich_fields: ["contact.work_emails"],
    custom: { contact_key: `expand_${idx}` },
  }));

  let enrichmentCredits = 0;
  const enrichmentByKey = new Map<string, { email: string | null; source: EmailSource | null }>();
  try {
    const webhookUrl = buildFullenrichWebhookUrl();
    const { resultsByKey, creditsUsed } = await enrichContactsViaFullEnrich(
      fullenrichKey,
      `expand-${companyName}-${persona.slug}-${Date.now()}`,
      enrichInputs,
      {
        webhookUrl: webhookUrl ?? undefined,
        buildCheckWebhook: webhookUrl
          ? (enrichmentId) => buildCheckWebhook(supabase, enrichmentId)
          : undefined,
        dedupContext: { supabase, companyName },
      }
    );
    enrichmentCredits = creditsUsed;
    for (const [key, res] of resultsByKey.entries()) {
      enrichmentByKey.set(key, pickBestEmailWithSource(res));
    }
  } catch (err) {
    console.warn(
      `[expand-prospect-profiles] Enrichment failed: ${err instanceof Error ? err.message : err}`
    );
  }

  // 5. Build les rows a inserer
  const rowsToInsert = personaFiltered.map((p, idx) => {
    const enr = enrichmentByKey.get(`expand_${idx}`);
    const profileTitle = p.employment?.current?.title || null;
    return {
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      email: enr?.email || null,
      email_source: enr?.email ? (enr.source ?? "fullenrich") : null,
      phone: null,
      job_title: profileTitle || persona.label,
      company_name: companyName,
      persona_id: persona.id,
      workspace_id: workspaceId,
      linkedin_url: p.social_profiles?.professional_network?.url || null,
      source_signal_id: sourceSignalId,
      company_group_id,
      status: "new",
      enrichment_data: p.employment?.current
        ? {
            fullenrich_profile: {
              current_title: p.employment.current.title,
              current_company: p.employment.current.company?.name,
              current_company_headcount: p.employment.current.company?.headcount,
              city: p.location?.city,
              country: p.location?.country,
              skills: (p.skills || []).slice(0, 8),
            },
          }
        : null,
    };
  });

  // 6. Insert en DB
  const { data: insertedProfiles, error: insertErr } = await supabase
    .from("prospect_profiles")
    .insert(rowsToInsert)
    .select("id, email, email_source");

  if (insertErr) {
    return new Response(
      JSON.stringify({ error: `Insert failed: ${insertErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Log audit events pour chaque email assigné
  if (insertedProfiles) {
    for (const profile of insertedProfiles) {
      if (profile.email) {
        await logEmailGenerated(supabase, {
          prospect_id: profile.id,
          email: profile.email,
          email_source: (profile.email_source ?? "fullenrich") as "deduced" | "fullenrich" | "crm" | "manual" | "unknown",
        });
      }
    }
  }

  // 7. Met a jour le more_available_counts sur TOUS les profils du group
  //    Le nouveau total "autres dispo" = totalAvailable_FE - (existant + newlyInserted)
  const newMoreAvailable = Math.max(0, (totalAvailable || 0) - existingProfiles.length - rowsToInsert.length);
  // On fetch un profil pour merger ses counts existants (on ne change que la
  // persona ciblee). Clés = persona.id (100% persona_id-based).
  const { data: oneProfile } = await supabase
    .from("prospect_profiles")
    .select("more_available_counts")
    .eq("company_group_id", company_group_id)
    .limit(1)
    .maybeSingle();
  const existingCounts =
    (oneProfile?.more_available_counts as Record<string, number> | null) || {};
  const updatedCounts = { ...existingCounts, [persona.id]: newMoreAvailable };

  await supabase
    .from("prospect_profiles")
    .update({ more_available_counts: updatedCounts })
    .eq("company_group_id", company_group_id);

  // 8. Declenche la generation de messages pour les nouveaux profils
  //    via generate-prospect-messages-bulk (fire-and-forget, Claude Batch API).
  try {
    await fetch(`${supabaseUrl}/functions/v1/generate-prospect-messages-bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        mode: "submit-batch",
        company_group_id,
      }),
    });
  } catch (msgErr) {
    console.warn(
      `[expand-prospect-profiles] Messages submit failed: ${msgErr instanceof Error ? msgErr.message : msgErr}`
    );
  }

  return new Response(
    JSON.stringify({
      inserted: rowsToInsert.length,
      more_available_counts: updatedCounts,
      credits_used: searchCredits + enrichmentCredits,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// Analyse les skills/titles LinkedIn des profils enrichis (FullEnrich) pour
// detecter les CRMs mentionnes. Source GRATUITE : data deja en DB depuis
// l'enrichissement initial, aucun nouveau credit consomme.
//
// Logique : si N employes (commerciaux, RH, IT, dirCo) mentionnent un CRM
// dans leurs skills LinkedIn ou leur titre actuel, c'est un signal tres fort
// qu'il s'agit du CRM utilise en interne.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { findCrmsInText } from "./jobs-analyzer.ts";

export type LinkedInScanResult = {
  matched_crms: { crm: string; source: "linkedin"; evidence: string; weight_multiplier: number }[];
  profiles_scanned: number;
  profiles_with_crm: number;
};

export async function scanLinkedInSkillsForCrm(
  companyGroupId: string,
  supabase: SupabaseClient,
): Promise<LinkedInScanResult> {
  const result: LinkedInScanResult = { matched_crms: [], profiles_scanned: 0, profiles_with_crm: 0 };

  const { data: profiles, error } = await supabase
    .from("prospect_profiles")
    .select("first_name, last_name, job_title, enrichment_data")
    .eq("company_group_id", companyGroupId)
    .not("enrichment_data", "is", null);

  if (error) {
    console.warn("[crm-detection/linkedin] failed to load profiles:", error.message);
    return result;
  }
  if (!profiles?.length) return result;
  result.profiles_scanned = profiles.length;

  // Compte par CRM avec liste de profils l'ayant mentionne
  const crmHits = new Map<string, { count: number; profiles: string[] }>();

  for (const p of profiles) {
    const fe = (p.enrichment_data as Record<string, unknown> | null)?.fullenrich_profile as
      | { skills?: unknown; current_title?: unknown }
      | undefined;
    const skills = Array.isArray(fe?.skills) ? (fe.skills as string[]).filter((s) => typeof s === "string") : [];
    const feTitle = typeof fe?.current_title === "string" ? fe.current_title : "";
    const directTitle = typeof p.job_title === "string" ? p.job_title : "";

    // Concatene tout dans un seul texte pour matcher
    const combinedText = [directTitle, feTitle, ...skills].join(" ");
    if (!combinedText.trim()) continue;

    const matches = findCrmsInText(combinedText);
    if (matches.length === 0) continue;

    result.profiles_with_crm++;
    const personLabel = `${p.first_name ?? ""} ${p.last_name ?? ""} (${directTitle || feTitle || "?"})`.trim();
    for (const crm of matches) {
      const existing = crmHits.get(crm) ?? { count: 0, profiles: [] };
      existing.count++;
      if (existing.profiles.length < 5) existing.profiles.push(personLabel);
      crmHits.set(crm, existing);
    }
  }

  // Emettre 1 signal par CRM, avec un multiplier proportionnel au nombre de mentions
  // (cap a 3 pour eviter les explosions sur grosses boites)
  for (const [crm, hits] of crmHits.entries()) {
    const multiplier = Math.min(hits.count, 3);
    result.matched_crms.push({
      crm,
      source: "linkedin",
      evidence: `${hits.count} employees mention ${crm}: ${hits.profiles.join("; ")}`,
      weight_multiplier: multiplier,
    });
  }

  return result;
}

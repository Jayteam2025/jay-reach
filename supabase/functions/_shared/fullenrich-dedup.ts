/**
 * Optimisation crédits FullEnrich via deduction d'email par pattern.
 *
 * Deux strategies imbriquees, appliquees AVANT puis PENDANT le bulk enrich :
 *
 *   1. Cross-job (gratuit)
 *      Si on a deja un pattern HIGH (>=85% confiance) pour le domaine de la
 *      boite (calcule sur des runs precedentes et stocke dans
 *      domain_email_patterns), on deduit DIRECTEMENT les emails de tous les
 *      contacts → 0 cred FullEnrich.
 *
 *   2. In-job (sample puis deduce)
 *      Pour un domaine inconnu, on enrichit d'abord 3 contacts via FullEnrich
 *      pour obtenir des echantillons → on detecte un pattern → si HIGH, on
 *      deduit les contacts restants gratuitement.
 *
 * Resolution du domaine : on cherche dans prospect_profiles les emails
 * existants pour ce company_name → on extrait le domain dominant.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEmail,
  detectPattern,
  type EmailSample,
  type PatternId,
  type PatternTier,
} from "./email-pattern.ts";
import type { FullEnrichContactInput, FullEnrichContactResult } from "./fullenrich.ts";

export interface DomainPattern {
  domain: string;
  pattern: PatternId;
  confidence: number;
  tier: PatternTier;
}

/**
 * Trouve le domaine email dominant pour une boite, en agregeant les emails
 * deja stockes dans prospect_profiles. Retourne null si on n'a pas assez
 * d'echantillons (>=2) pour etre confiant.
 */
export async function resolveCompanyDomain(
  supabase: SupabaseClient,
  companyName: string,
): Promise<string | null> {
  if (!companyName) return null;

  const { data, error } = await supabase
    .from("prospect_profiles")
    .select("email")
    .eq("company_name", companyName)
    .is("deleted_at", null)
    .not("email", "is", null)
    .limit(20);

  if (error || !data) return null;

  const counts = new Map<string, number>();
  for (const row of data) {
    const email = row.email as string | null;
    if (!email) continue;
    const domain = email.split("@")[1]?.toLowerCase().trim();
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topDomain, topCount] = sorted[0];
  if (topCount < 2) return null;
  return topDomain;
}

/**
 * Lit le pattern email stocke pour un domaine. Retourne null si absent ou
 * si le tier n'est pas exploitable (skip).
 *
 * Utilise la fonction SQL `get_effective_tier` qui combine le tier stocke
 * avec le bounce rate empirique observe sur les emails deduits du domaine.
 * Si bounce_rate > 30% (volume >= 5), le tier est degrade en skip
 * automatiquement (sauf si source='manual_override'). Cf migration
 * 20260511150000_bounce_learning.sql.
 */
export async function getDomainPattern(
  supabase: SupabaseClient,
  domain: string,
): Promise<DomainPattern | null> {
  const { data, error } = await supabase
    .from("domain_email_patterns")
    .select("domain, pattern, confidence, tier")
    .eq("domain", domain)
    .maybeSingle();

  if (error || !data) return null;
  if (data.tier === "skip") return null;

  // Tier effectif : recalcule en tenant compte du bounce rate empirique
  const { data: effective, error: rpcErr } = await supabase.rpc(
    "get_effective_tier",
    { domain_param: domain },
  );
  if (rpcErr) {
    // En cas d'erreur RPC, on fallback sur le tier stocke (defensive)
    console.warn(`[fullenrich-dedup] get_effective_tier RPC failed for ${domain}: ${rpcErr.message}`);
    return data as DomainPattern;
  }

  if (effective === "skip") {
    console.log(
      `[fullenrich-dedup] tier downgrade for "${domain}" : stored=${data.tier} -> effective=skip (bounce rate trop eleve)`,
    );
    return null;
  }

  return { ...data, tier: effective ?? data.tier } as DomainPattern;
}

/**
 * Construit un FullEnrichContactResult "deduit" pour un contact donne.
 * Le statut est marque DEDUCED_HIGH ou DEDUCED_MEDIUM pour que le caller
 * puisse les distinguer des emails verifies par FE.
 */
export function buildDeducedResult(
  contact: FullEnrichContactInput,
  pattern: PatternId,
  domain: string,
  tier: PatternTier,
): FullEnrichContactResult {
  const email = buildEmail(pattern, contact.first_name, contact.last_name, domain);
  const status = tier === "high" ? "DEDUCED_HIGH" : "DEDUCED_MEDIUM";

  return {
    input: contact,
    custom: contact.custom,
    contact_info: email
      ? {
          most_probable_work_email: { email, status },
          work_emails: [{ email, status }],
        }
      : {
          work_emails: [],
        },
  };
}

/**
 * Construit des EmailSample depuis les resultats FE d'un bulk wave 1.
 * Ne garde que les emails effectivement trouves (deliverable ou catch-all).
 */
export function extractSamplesFromResults(
  contactsByKey: Map<string, FullEnrichContactInput>,
  results: Map<string, FullEnrichContactResult>,
): EmailSample[] {
  const samples: EmailSample[] = [];
  for (const [key, result] of results.entries()) {
    const contact = contactsByKey.get(key);
    if (!contact) continue;
    const email = result.contact_info?.most_probable_work_email?.email
      || result.contact_info?.work_emails?.[0]?.email
      || null;
    if (!email) continue;
    samples.push({
      first_name: contact.first_name,
      last_name: contact.last_name,
      email,
    });
  }
  return samples;
}

/**
 * Detecte le pattern depuis les resultats wave 1, et retourne le pattern +
 * domain si exploitables. Le domain est extrait du 1er sample.
 */
export function detectPatternFromWave1(
  samples: EmailSample[],
): { pattern: PatternId; tier: PatternTier; confidence: number; domain: string } | null {
  if (samples.length < 2) return null;

  const result = detectPattern(samples);
  if (!result.pattern || result.tier === "skip") return null;

  // Domain depuis le 1er sample (suppose homogene au sein d'une boite)
  const firstEmail = samples.find((s) => s.email)?.email;
  if (!firstEmail) return null;
  const domain = String(firstEmail).split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;

  return {
    pattern: result.pattern,
    tier: result.tier,
    confidence: result.confidence,
    domain,
  };
}

/**
 * Upsert le pattern detecte en wave 1 dans domain_email_patterns. Permet
 * aux runs futures de skip FullEnrich entierement (cross-job dedup).
 *
 * Respecte les patterns avec `source = 'manual_override'` : si un admin a
 * lock un pattern, l'algo ne doit pas l'ecraser, meme si la detection
 * actuelle suggere autre chose. Cf migration 20260511120000.
 */
export async function upsertDetectedPattern(
  supabase: SupabaseClient,
  domain: string,
  pattern: PatternId,
  tier: PatternTier,
  confidence: number,
  sampleCount: number,
): Promise<void> {
  // Lecture prealable pour respecter les locks manuels
  const { data: existing } = await supabase
    .from("domain_email_patterns")
    .select("source")
    .eq("domain", domain)
    .maybeSingle();

  if (existing?.source === "manual_override") {
    console.log(
      `[fullenrich-dedup] skip upsert for "${domain}" : pattern locke (manual_override)`,
    );
    return;
  }

  const { error } = await supabase
    .from("domain_email_patterns")
    .upsert({
      domain,
      pattern,
      confidence,
      tier,
      sample_count: sampleCount,
      hits: Math.round(confidence * sampleCount),
      source: "auto",
      updated_at: new Date().toISOString(),
    }, { onConflict: "domain" });

  if (error) {
    console.warn(`[fullenrich-dedup] upsert pattern failed for ${domain}: ${error.message}`);
  }
}

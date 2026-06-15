// supabase/functions/_shared/crm-detection/jobs-analyzer.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { JobsAnalysisResult, JobMatch } from "./types.ts";

// Patterns alignes sur la whitelist CRM stricte. Tolerance maximale :
// - tirets/espaces/points entre les mots ([\s\-\.]?)
// - acronymes (SFDC, D365, MSCRM)
// - anciennes marques (Sendinblue, ProsperWorks, Infusionsoft)
// Brevo/Marketo/Eloqua/Mailchimp etc volontairement exclus (marketing/ESP, pas CRM).
const CRM_PATTERNS: Record<string, RegExp> = {
  // Salesforce + ecosysteme (Pardot, Sales/Marketing/Service Cloud)
  "Salesforce": /\b(salesforce(?:\.com)?|sales[\s\-\.]?force|sfdc|pardot|sales[\s\-]?cloud|marketing[\s\-]?cloud|service[\s\-]?cloud|salesforce\s+lightning)\b/i,

  // HubSpot
  "HubSpot": /\bhub[\s\-]?spot\b/i,

  // Pipedrive
  "Pipedrive": /\bpipe[\s\-]?drive\b/i,

  // Microsoft Dynamics 365 (synonymes : D365, MSCRM, MS Dynamics)
  "Microsoft Dynamics": /\b(microsoft[\s\-]?dynamics(?:[\s\-]?365)?|dynamics[\s\-]?(?:365|crm)|\bd[\s\-]?365\b|ms[\s\-]?crm|ms[\s\-]?dynamics)\b/i,

  // Zoho (CRM, One, SalesIQ, Desk, Bigin)
  "Zoho": /\bzoho(?:[\s\-]?(?:crm|one|salesiq|desk|bigin|projects))?\b/i,

  // Odoo (anciennement OpenERP)
  "Odoo": /\b(odoo|openerp)\b/i,

  // Teamleader (Focus, Orbit) — exige un contexte produit : "team leader" /
  // "teamleader" nu est un intitulé de poste (chef d'équipe), pas le CRM.
  "Teamleader": /\bteam[\s\-]?leader[\s\-]?(?:focus|orbit|crm)\b|teamleader\.eu/i,

  // Sellsy
  "Sellsy": /\bsellsy\b/i,

  // monday.com (CRM module specifiquement, pas le projet management generique)
  "monday.com": /\bmonday(?:\.com|[\s\-]?work[\s\-]?management)?[\s\-]?(?:crm|sales|sales[\s\-]?crm)\b/i,

  // ActiveCampaign
  "ActiveCampaign": /\bactive[\s\-]?campaign\b/i,

  // Sage CRM (distinct de Sage compta)
  "Sage CRM": /\bsage[\s\-]?crm\b/i,

  // SugarCRM (anciennement Sugar Open Source)
  "SugarCRM": /\bsugar[\s\-]?crm\b/i,

  // Freshsales / Freshworks (Freshworks CRM = Freshsales suite)
  "Freshsales": /\b(fresh[\s\-]?sales|fresh[\s\-]?works(?:[\s\-]?crm)?)\b/i,

  // Copper CRM (anciennement ProsperWorks)
  "Copper CRM": /\b(copper[\s\-]?crm|prosper[\s\-]?works)\b/i,

  // Insightly
  "Insightly": /\binsightly\b/i,

  // Apptivo
  "Apptivo": /\bapptivo\b/i,

  // Vtiger (Vtiger CRM, Vtiger Cloud)
  "Vtiger": /\bvtiger(?:[\s\-]?crm)?\b/i,

  // Close (anciennement Close.io) — exige un contexte produit : "close" nu est
  // un verbe commercial courant (closer un deal), pas le CRM.
  "Close": /\bclose[\s\-]?crm\b|\bclose\.(?:com|io)\b/i,

  // Salesflare
  "Salesflare": /\bsales[\s\-]?flare\b/i,

  // Nutshell CRM
  "Nutshell": /\bnutshell(?:[\s\-]?crm)?\b/i,

  // Streak (CRM pour Gmail)
  "Streak": /\bstreak[\s\-]?crm\b/i,

  // NoCRM (anciennement YouDontNeedACRM)
  "NoCRM": /\b(no[\s\-]?crm(?:\.io)?|you[\s\-]?dont[\s\-]?need[\s\-]?a[\s\-]?crm)\b/i,

  // Keap (anciennement Infusionsoft)
  "Keap": /\b(keap|infusion[\s\-]?soft)\b/i,

  // Nimble
  "Nimble": /\bnimble[\s\-]?crm\b/i,

  // Less Annoying CRM
  "Less Annoying CRM": /\bless[\s\-]?annoying[\s\-]?crm\b/i,

  // Bitrix24
  "Bitrix24": /\bbitrix[\s\-]?24\b/i,

  // AmoCRM
  "AmoCRM": /\bamo[\s\-]?crm\b/i,

  // Zendesk Sell (anciennement Base)
  "Zendesk Sell": /\b(zendesk[\s\-]?sell|getbase|base[\s\-]?crm)\b/i,

  // FR / Europe
  "Axonaut": /\baxonaut\b/i,
  "Eudonet": /\beudonet(?:[\s\-]?crm)?\b/i,
  "Efficy": /\befficy(?:[\s\-]?crm)?\b/i,
  "Saalz": /\bsaalz\b/i,
  "Initiative CRM": /\binitiative[\s\-]?crm\b/i,
  "Karlia": /\bkarlia\b/i,
  "Furious Squad": /\b(furious[\s\-]?squad|furiously[\s\-]?squadded)\b/i,
  "Ines CRM": /\bines[\s\-]?crm\b/i,
  "Iko System": /\biko[\s\-]?system\b/i,
  "Tilkee": /\btilkee\b/i,

  // Enterprise
  "SAP C4C": /\b(sap[\s\-]?c4c|sap[\s\-]?sales[\s\-]?cloud|sap[\s\-]?customer[\s\-]?(?:cloud|experience))\b/i,
  "Oracle NetSuite": /\b(oracle[\s\-]?net[\s\-]?suite|net[\s\-]?suite|netsuite[\s\-]?one[\s\-]?world)\b/i,

  // Open source
  "EspoCRM": /\bespo[\s\-]?crm\b/i,
  "SuiteCRM": /\bsuite[\s\-]?crm\b/i,
  "Yoneos CRM": /\byoneos(?:[\s\-]?crm)?\b/i,

  // Sectoriels
  "Apimo": /\bapimo\b/i,
  "Hektor": /\bhektor[\s\-]?crm\b/i,
};

export function findCrmsInText(text: string): string[] {
  const found: string[] = [];
  for (const [crm, pattern] of Object.entries(CRM_PATTERNS)) {
    if (pattern.test(text)) found.push(crm);
  }
  return found;
}

/**
 * Si ≥ 3 offres ont le CRM dans leur titre, c'est probablement le métier
 * de la boîte (ESN/intégrateur), pas son outil interne.
 */
export function isLikelyEsnConsulting(jobs: JobMatch[], crm: string): boolean {
  const pattern = CRM_PATTERNS[crm];
  if (!pattern) return false;
  const titlesMentioning = jobs.filter((j) => pattern.test(j.job_title));
  return titlesMentioning.length >= 3;
}

export async function analyzeJobsForCrm(
  companyGroupId: string,
  companyName: string,
  supabase: SupabaseClient,
): Promise<JobsAnalysisResult> {
  // Récupère les profile ids du groupe pour matcher matched_prospect_id
  const { data: profileRows } = await supabase
    .from("prospect_profiles")
    .select("id")
    .eq("company_group_id", companyGroupId);
  const profileIds: string[] = (profileRows ?? []).map((r: { id: string }) => r.id);

  // Lit les signaux de cette entreprise (par company_name OU par matched_prospect_id)
  let query = supabase
    .from("prospect_signals")
    .select("source, source_url, raw_content, extracted_data, company_name, matched_prospect_id")
    .limit(50);

  if (profileIds.length > 0) {
    query = query.or(`company_name.eq.${companyName},matched_prospect_id.in.(${profileIds.join(",")})`);
  } else {
    query = query.eq("company_name", companyName);
  }

  const { data: signals, error } = await query;

  if (error) {
    console.warn("[crm-detection/jobs-analyzer] Failed to read prospect_signals:", error);
    return [];
  }

  const matches: JobsAnalysisResult = [];
  for (const sig of signals ?? []) {
    const text = `${sig.raw_content ?? ""} ${(sig.extracted_data as Record<string, unknown>)?.job_title ?? ""}`;
    const matched_crms = findCrmsInText(text);
    if (matched_crms.length === 0) continue;

    matches.push({
      source: sig.source ?? "unknown",
      job_url: sig.source_url ?? "",
      job_title: ((sig.extracted_data as Record<string, unknown>)?.job_title as string) ?? "",
      matched_crms,
    });
  }

  // Filtre ESN : pour chaque CRM trouvé, si la boîte a 3+ offres avec ce CRM
  // dans le titre, on retire ce CRM des matches.
  const distinctCrms = new Set(matches.flatMap((m) => m.matched_crms));
  for (const crm of distinctCrms) {
    if (isLikelyEsnConsulting(matches, crm)) {
      for (const m of matches) {
        m.matched_crms = m.matched_crms.filter((c) => c !== crm);
      }
    }
  }
  return matches.filter((m) => m.matched_crms.length > 0);
}

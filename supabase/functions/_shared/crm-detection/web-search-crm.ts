// Recherche Brave ciblee : pour chaque CRM majeur, on cherche
// `"NomEntreprise" CRMNom` et on detecte les signaux dans les resultats web.
//
// Deux signaux possibles :
//   1. CUSTOMER_STORY_PATTERNS : URL chez l'editeur CRM (case study) — fort,
//      source "customer_story" (poids 3).
//   2. URL d'offre d'emploi mentionnant le CRM, attribuable a la boite :
//        - sur le domaine RESOLU de la boite (careers.boite.com/...)
//        - sur un job board externe ET le titre cite le nom de la boite
//      Signal moyen, source "jobs" (poids 2) : recruter sur un CRM != l'editer.
//
// Attribution stricte (incident Linkt 03/06/2026) : on ne fait JAMAIS de match
// par sous-chaine sur le host (ex: "linktr.ee".includes("linkt")). On compare au
// domaine resolu (egalite ou sous-domaine) et on rejette les agregateurs de
// liens / raccourcisseurs, qui ne sont jamais le domaine propre d'une boite.
//
// Coute : 1 query Brave par CRM majeur (~9 calls par detection).
// Limite : Brave Search API gratuit ~2000 req/mois.

import {
  CUSTOMER_STORY_PATTERNS,
  type CrmName,
} from "./signatures.ts";

// Top CRMs pour lesquels on cherche les customer stories. Ordre = priorite
// (les plus courants en B2B FR d'abord).
const CRMS_TO_SEARCH: { crm: CrmName; query_label: string }[] = [
  { crm: "Salesforce", query_label: "Salesforce" },
  { crm: "HubSpot", query_label: "HubSpot" },
  { crm: "Pipedrive", query_label: "Pipedrive" },
  { crm: "Zoho", query_label: "Zoho CRM" },
  { crm: "Microsoft Dynamics", query_label: "Microsoft Dynamics 365" },
  { crm: "Sellsy", query_label: "Sellsy" },
  { crm: "Teamleader", query_label: "Teamleader" },
  { crm: "Axonaut", query_label: "Axonaut" },
  { crm: "Odoo", query_label: "Odoo CRM" },
];

// Job boards externes : un resultat ici n'est attribuable a la boite que si le
// titre cite explicitement son nom (mot entier).
const JOB_BOARDS = /welcometothejungle|hellowork|glassdoor|indeed|apec\.fr|monster\.|regionsjob|cadremploi|talents|jooble|joobs/i;
const JOB_KEYWORD = /\b(jobs?|careers?|rh|emploi|recrutement|recruiting|offre|talent|admin|expert|consultant|developer|developpeur|manager)\b/i;

// Agregateurs de liens, raccourcisseurs et pages "bio" : jamais le domaine
// propre d'une entreprise. Eviter de les attribuer a une boite dont le nom est
// une sous-chaine du host (Linktree / "Linkt", lnk.to / "Lnk", etc.).
const LINK_AGGREGATORS = /^(?:[a-z0-9-]+\.)*(?:linktr\.ee|linktree\.com|beacons\.ai|bio\.link|lnk\.bio|lnk\.to|bit\.ly|t\.co|tinyurl\.com|carrd\.co|taplink\.cc|campsite\.bio|solo\.to|msha\.ke|about\.me|linkin\.bio|allmylinks\.com)$/i;

// Identification stricte du CRM dans un texte (URL + titre). On exige un contexte
// produit pour les homonymes : "microsoft 365" (Office) != Dynamics 365 (CRM),
// "team leader" (poste) != Teamleader (CRM). Évite la confusion mot-courant/CRM.
const CRM_USAGE_PATTERNS: Record<string, RegExp> = {
  "Salesforce": /\b(salesforce|sfdc|pardot|sales[\s-]?cloud|service[\s-]?cloud|marketing[\s-]?cloud)\b/i,
  "HubSpot": /\bhub[\s-]?spot\b/i,
  "Pipedrive": /\bpipe[\s-]?drive\b/i,
  "Zoho": /\bzoho(?:[\s-]?(?:crm|one|bigin|desk))?\b/i,
  // Exige "dynamics" : "microsoft 365" seul (Office) ne matche pas.
  "Microsoft Dynamics": /\b(microsoft[\s-]?dynamics|dynamics[\s-]?(?:365|crm)|d365|ms[\s-]?dynamics|ms[\s-]?crm)\b/i,
  "Sellsy": /\bsellsy\b/i,
  // Exige un contexte produit : "team leader" / "teamleader" nu = intitulé de poste.
  "Teamleader": /\bteamleader[\s-]?(?:crm|focus|orbit)\b|teamleader\.eu/i,
  "Axonaut": /\baxonaut\b/i,
  "Odoo": /\b(odoo|openerp)\b/i,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type WebSignal = { crm: CrmName; source: "customer_story" | "jobs"; evidence: string };

export type WebSearchScanResult = {
  matched_crms: WebSignal[];
  queries_performed: number;
};

/** Tokens significatifs du nom de boite (>= 4 lettres), normalises ASCII. */
function companyTokensOf(companyName: string): string[] {
  return companyName.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

/** Host == domaine resolu OU sous-domaine de celui-ci. Pas de sous-chaine. */
function hostMatchesResolvedDomain(urlHost: string, resolvedDomain: string | null): boolean {
  if (!resolvedDomain) return false;
  const rd = resolvedDomain.toLowerCase().replace(/^www\./, "");
  if (!rd) return false;
  return urlHost === rd || urlHost.endsWith("." + rd);
}

/**
 * Logique pure d'attribution d'un CRM a une entreprise a partir des resultats
 * de recherche web pour UN CRM donne. Sans I/O — testable en isolation.
 */
export function matchCrmInResults(
  companyName: string,
  resolvedDomain: string | null,
  crm: CrmName,
  queryLabel: string,
  results: { url: string; title: string }[],
): WebSignal | null {
  const tokenRegexes = companyTokensOf(companyName).map((t) => new RegExp(`\\b${t}\\b`, "i"));
  const usagePattern = CRM_USAGE_PATTERNS[crm] ??
    new RegExp(`\\b${escapeRegExp(queryLabel.toLowerCase().split(/\s+/)[0])}\\b`, "i");

  // Signal 1 : URL chez l'editeur CRM (customer story / case study). L'URL doit
  // citer la boite (token en mot entier) — sinon la recherche renvoie l'etude de
  // cas d'une AUTRE boite et le pattern d'URL matche quand meme (Diplomeo->Planet42).
  for (const r of results) {
    const urlLower = r.url.toLowerCase();
    const urlMentionsCompany = tokenRegexes.length > 0 && tokenRegexes.some((re) => re.test(urlLower));
    if (!urlMentionsCompany) continue;
    for (const pattern of CUSTOMER_STORY_PATTERNS) {
      if (pattern.crm === crm && pattern.pattern.test(r.url)) {
        return {
          crm,
          source: "customer_story",
          evidence: `customer-story: "${companyName}" ${queryLabel} -> ${r.url}`,
        };
      }
    }
  }

  // Signal 2 : offre d'emploi mentionnant le CRM, attribuable a la boite.
  for (const r of results) {
    let urlHost: string;
    try {
      urlHost = new URL(r.url.toLowerCase()).hostname.replace(/^www\./, "");
    } catch {
      continue; // URL malformee
    }
    // Agregateurs de liens / raccourcisseurs : jamais le domaine d'une boite.
    if (LINK_AGGREGATORS.test(urlHost)) continue;

    const titleLower = (r.title ?? "").toLowerCase();
    const fullText = `${r.url.toLowerCase()} ${titleLower}`;

    // Identification stricte du CRM (homonymes/produits), pas une sous-chaine.
    if (!usagePattern.test(fullText)) continue;
    if (!JOB_KEYWORD.test(fullText)) continue;

    const onCompanyDomain = hostMatchesResolvedDomain(urlHost, resolvedDomain);
    const onJobBoard = JOB_BOARDS.test(urlHost);
    // Titre cite le nom de la boite : mot entier requis (pas "Linkt" dans "Linktree").
    const titleMentionsCompany = tokenRegexes.length > 0 && tokenRegexes.some((re) => re.test(titleLower));

    // Match valide si :
    //   - URL sur le domaine resolu de la boite (signal direct)
    //   - URL sur un job board ET le titre cite le nom de la boite
    const validMatch = onCompanyDomain || (onJobBoard && titleMentionsCompany);
    if (!validMatch) continue;

    const reason = onCompanyDomain ? "site-jobs" : "job-board";
    return {
      crm,
      source: "jobs",
      evidence: `${reason}: "${companyName}" recrute ${queryLabel} via ${r.url}`,
    };
  }

  return null;
}

async function braveSearch(apiKey: string, query: string): Promise<{ url: string; title: string }[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=FR&search_lang=fr`;
  try {
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { web?: { results?: { url?: string; title?: string }[] } };
    return (data.web?.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ url: r.url!, title: r.title ?? "" }));
  } catch {
    return [];
  }
}

/**
 * Pour chaque CRM majeur, query Brave `"Nom" CRMNom` et cherche un signal
 * (customer story editeur ou offre d'emploi attribuable a la boite).
 * `resolvedDomain` (le domaine deja resolu par detect-crm) sert a attribuer
 * strictement une URL a l'entreprise.
 */
export async function searchWebForCrmCustomerStory(
  companyName: string,
  resolvedDomain: string | null = null,
): Promise<WebSearchScanResult> {
  const result: WebSearchScanResult = { matched_crms: [], queries_performed: 0 };
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!apiKey) return result;

  const queries = CRMS_TO_SEARCH.map((c) => ({
    ...c,
    promise: braveSearch(apiKey, `"${companyName}" ${c.query_label}`),
  }));

  const seenCrm = new Set<CrmName>();
  for (const { crm, query_label, promise } of queries) {
    const results = await promise;
    result.queries_performed++;
    if (results.length === 0) {
      console.log(`[crm-detection/web-search] no results for "${companyName}" ${query_label}`);
      continue;
    }
    if (seenCrm.has(crm)) continue;

    const signal = matchCrmInResults(companyName, resolvedDomain, crm, query_label, results);
    if (signal) {
      result.matched_crms.push(signal);
      seenCrm.add(crm);
    } else {
      const topUrls = results.slice(0, 3).map((r) => r.url).join(" | ");
      console.log(`[crm-detection/web-search] no signal for "${companyName}" ${query_label}. Top URLs: ${topUrls}`);
    }
  }

  return result;
}

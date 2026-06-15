// supabase/functions/_shared/crm-detection/domain-resolver.ts
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { DomainResult, CompanyMetadata } from "./types.ts";

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const DOMAIN_BLACKLIST = new Set([
  // Reseaux sociaux
  "linkedin.com", "facebook.com", "twitter.com", "x.com",
  "instagram.com", "tiktok.com", "viadeo.com", "youtube.com",
  // Annuaires / data prospection / open data FR (gros polluants observes)
  "societe.com", "societeinfo.com", "infogreffe.fr", "verif.com",
  "b-reputation.com", "manageo.fr", "kompass.com",
  "annuaire-entreprises.data.gouv.fr", "data.gouv.fr",
  "service-public.fr", "entreprises.gouv.fr", "bodacc.fr",
  "verif.fr", "score3.fr", "europages.fr", "europages.com",
  "rubypayeur.com", "trustfolio.com", "sireninfo.com", "actulegales.fr",
  "eibabo.com", "annuaire-mairie.fr", "linternaute.com",
  "annuairefrancais.fr", "entreprises.annuairefrancais.fr",
  "data-prospection.fr", "data.inpi.fr", "inpi.fr",
  "gowork.fr", "gowork.com", "edecideur.com", "francebilan.fr",
  "lagazettefrance.fr", "entreprises.lagazettefrance.fr",
  "pagesjaunes.fr", "118000.fr", "118712.fr", "hoodspot.fr",
  "xerfi.com", "xerfi-info.com",
  "doctrine.fr",
  "yoolicom.fr", "yoolicom.com",
  "impayes.com", "infonet.fr", "northdata.fr", "north-data.com",
  "french-corporate.com", "corporama.com", "journal-economique.fr",
  "legadom.com", "ceprocteretgamble.com", "francebilan.fr",
  "vikta.com", "app.vikta.com",
  // Sites d'emploi
  "indeed.com", "indeed.fr", "glassdoor.fr", "welcometothejungle.com",
  "francetravail.fr", "pole-emploi.fr", "hellowork.com", "monster.fr",
  "regionsjob.com", "apec.fr", "cadremploi.fr",
  // Encyclopedies / dictionnaires / generalistes
  "wikipedia.org", "wiki.com", "crunchbase.com",
  "larousse.fr", "leconjugueur.com", "linternaute.fr",
  // Presse generaliste et financiere
  "lefigaro.fr", "lesechos.fr", "boursorama.com", "boursier.com",
  "bloomberg.com", "yahoo.com", "finance.yahoo.com",
  "reuters.com", "ft.com", "wsj.com", "forbes.com", "investopedia.com",
  // Presse industrielle FR
  "usinenouvelle.com", "industrie-techno.com", "lsa-conso.fr", "lemoniteur.fr",
  // B2B parasites
  "bestfoodimporters.com", "exportpages.com", "go4worldbusiness.com",
  // Domaines gouvernementaux US qui remontent par accident
  "state.mi.us", "state.ny.us", "state.tx.us", "illinois.gov", "michigan.gov",
]);

// Verifie si un domain est gouvernemental (etranger) — ces TLDs ne sont
// jamais le site d'une boite FR.
function isGovOrStateDomain(domain: string): boolean {
  return /\.(gov|state\.[a-z]{2}\.us)$/i.test(domain);
}

const ENRICHMENT_PATHS: string[][] = [
  ["company", "website"],
  ["company", "domain"],
  ["company_website"],
  ["website"],
  ["organization", "website"],
  ["organization", "domain"],
];

export function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  if (!DOMAIN_REGEX.test(domain)) return false;
  if (DOMAIN_BLACKLIST.has(domain)) return false;
  if (isGovOrStateDomain(domain)) return false;
  for (const black of DOMAIN_BLACKLIST) {
    if (domain.endsWith("." + black)) return false;
  }
  return true;
}

export function extractDomain(input: string): string | null {
  if (!input) return null;
  let cleaned = input.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, "");
  cleaned = cleaned.split("/")[0].split("?")[0].split("#")[0];
  cleaned = cleaned.replace(/^www\./, "");
  cleaned = cleaned.split(":")[0];
  if (!isValidDomain(cleaned)) return null;
  return cleaned;
}

export function extractFromEnrichmentJson(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  for (const path of ENRICHMENT_PATHS) {
    let cur: unknown = data;
    for (const key of path) {
      if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === "string") {
      const domain = extractDomain(cur);
      if (domain) return domain;
    }
  }
  return null;
}

export async function resolveDomain(
  company: CompanyMetadata,
  supabase: SupabaseClient,
): Promise<DomainResult> {
  console.log(`[crm-detection/domain-resolver] resolving for ${company.name} (siren=${company.siren ?? "none"})`);

  // 1. enrichment_data des profils du groupe (au cas où FullEnrich expose company.website
  // dans certains formats, meme si en pratique on ne l'a pas observe).
  const { data: profiles } = await supabase
    .from("prospect_profiles")
    .select("enrichment_data")
    .eq("company_group_id", company.group_id)
    .not("enrichment_data", "is", null)
    .limit(5);

  for (const p of profiles ?? []) {
    const domain = extractFromEnrichmentJson(p.enrichment_data);
    if (domain) return { domain, source: "fullenrich" };
  }

  // 2. Brave search (queries restreintes au site officiel FR)
  const fromBrave = await searchDomainViaBrave(company.name, company.siren);
  if (fromBrave) return { domain: fromBrave, source: "brave" };

  return null;
}

async function searchDomainViaBrave(name: string, siren?: string): Promise<string | null> {
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!apiKey) {
    console.warn("[crm-detection/domain-resolver] BRAVE_SEARCH_API_KEY not set, skipping");
    return null;
  }

  // Cascade de queries du plus precis au plus large. Le SIREN desambigue tout
  // (boites homonymes internationales, mauvais TLD, etc.).
  const queries: string[] = [];
  if (siren) {
    queries.push(`"${name}" ${siren}`);
    queries.push(`"${name}" SIREN ${siren}`);
  }
  queries.push(`"${name}" site officiel France`);
  queries.push(`"${name}" entreprise France`);

  const domains: string[] = [];
  for (const query of queries) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=FR&search_lang=fr`;
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": apiKey, "Accept": "application/json" },
    });
    if (!res.ok) {
      console.warn("[crm-detection/domain-resolver] Brave search failed:", res.status);
      continue;
    }
    const data = await res.json();
    const results = data.web?.results ?? [];
    for (const r of results) {
      const domain = extractDomain(r.url ?? "");
      if (domain) domains.push(domain);
    }
  }

  if (domains.length === 0) return null;

  const best = pickBestDomain(name, domains);
  if (best) {
    console.log(`[crm-detection/domain-resolver] Brave -> ${best} (parmi ${new Set(domains).size} candidats)`);
  } else {
    console.warn(`[crm-detection/domain-resolver] No matching domain for "${name}" — rejected: ${[...new Set(domains)].slice(0, 5).join(", ")}`);
  }
  return best;
}

// Segments de domaine indiquant une section/microsite (catalogue, shop, jobs...)
// et non la racine corporate. Match EXACT de segment (split sur "." et "-") pour
// ne pas pénaliser un nom légitime contenant la sous-chaine (ex: "myshopify").
const MICROSITE_SEGMENTS = new Set([
  "catalogue", "catalog", "shop", "store", "boutique", "ecommerce",
  "jobs", "job", "careers", "career", "recrutement", "recrute", "carriere", "carrieres",
  "blog", "news", "actualites", "media", "medias", "press", "presse",
  "support", "help", "aide", "docs", "doc", "developers", "developer", "dev", "developpeur",
  "portail", "portal", "extranet", "intranet", "espace", "faq", "login",
  "partenaire", "partenaires", "partner", "partners",
]);

function domainSegments(domain: string): string[] {
  return domain.toLowerCase().split(/[.\-]/).filter(Boolean);
}

/** Label juste avant le TLD ("ppgintl" pour ppgintl.com, "example" pour a.example.fr). */
function sldLabel(domain: string): string {
  const labels = domain.toLowerCase().split(".");
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}

function hyphenCount(s: string): number {
  return (s.match(/-/g) ?? []).length;
}

/** Tokens significatifs du nom (>=4), ou le nom court entier (>=3) en repli. */
function companyNameTokens(name: string): string[] {
  const STOPWORDS = new Set([
    "groupe", "compagnie", "societe", "société", "france", "europe", "european",
    "international", "global", "industries", "industrie", "industriel", "service", "services", "solutions",
  ]);
  const norm = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").trim();
  const toks = norm.split(/\s+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  if (toks.length > 0) return toks;
  const short = norm.replace(/\s/g, "");
  return short.length >= 3 ? [short] : [];
}

function scoreDomainCandidate(domain: string, name: string): number {
  const tld = domain.toLowerCase().split(".").pop() ?? "";
  const sld = sldLabel(domain);
  const labelCount = domain.split(".").length;
  const segs = domainSegments(domain);
  const toks = companyNameTokens(name);

  let score = 0;
  if (looksLikeCompanyName(domain, name)) score += 10;
  // Un token du nom est un PRÉFIXE du SLD (ppg -> ppgintl, attila -> attila).
  if (toks.some((t) => sld.startsWith(t))) score += 4;
  if (tld === "fr") score += 2;
  else if (tld === "com" || tld === "eu") score += 1;
  if (labelCount === 2) score += 3; // racine corporate, pas un sous-domaine
  score -= 2 * hyphenCount(sld); // microsites hyphénés
  if (segs.some((s) => MICROSITE_SEGMENTS.has(s))) score -= 8; // section/microsite
  return score;
}

type ScoredDomain = { domain: string; score: number; matchesName: boolean };

/** Tri DÉTERMINISTE : score, puis moins de hyphens, SLD plus court, plus court, alpha. */
function compareScored(a: ScoredDomain, b: ScoredDomain): number {
  if (b.score !== a.score) return b.score - a.score;
  const ha = hyphenCount(a.domain), hb = hyphenCount(b.domain);
  if (ha !== hb) return ha - hb;
  const sa = sldLabel(a.domain).length, sb = sldLabel(b.domain).length;
  if (sa !== sb) return sa - sb;
  if (a.domain.length !== b.domain.length) return a.domain.length - b.domain.length;
  return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0;
}

/**
 * Choisit le meilleur domaine parmi des candidats, de façon DÉTERMINISTE
 * (indépendant de l'ordre d'entrée) et en privilégiant la racine corporate
 * plutôt qu'un microsite (catalogue/shop/jobs...). Retourne null si aucun
 * candidat ne ressemble au nom de la boîte.
 */
export function pickBestDomain(name: string, domains: string[]): string | null {
  const seen = new Set<string>();
  const scored: ScoredDomain[] = [];
  for (const d of domains) {
    const dom = typeof d === "string" ? d.toLowerCase() : "";
    if (!dom || seen.has(dom)) continue;
    seen.add(dom);
    scored.push({ domain: dom, score: scoreDomainCandidate(dom, name), matchesName: looksLikeCompanyName(dom, name) });
  }
  if (scored.length === 0) return null;

  // STRICT : candidats dont le domaine ressemble au nom.
  const strict = scored.filter((c) => c.matchesName);
  if (strict.length > 0) {
    strict.sort(compareScored);
    return strict[0].domain;
  }

  // LOOSE : nom court/acronyme (ABB, ELIS...) contenu dans un candidat.
  const normName = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  if (normName.length >= 3 && normName.length <= 6) {
    const acro = scored.filter((c) => c.domain.replace(/[^a-z0-9]/g, "").includes(normName));
    if (acro.length > 0) {
      acro.sort(compareScored);
      return acro[0].domain;
    }
  }
  return null;
}

/**
 * Heuristique simple : le domain "ressemble" au nom de la boite si au moins
 * un mot significatif du nom (>=4 chars, pas un mot vide) apparait dans le
 * domain. Tolere les variations (accents, espaces, casse).
 */
function looksLikeCompanyName(domain: string, name: string): boolean {
  const STOPWORDS = new Set([
    "groupe", "compagnie", "societe", "société", "france",
    "europe", "european", "international", "global", "industries",
    "industrie", "industriel", "service", "services", "solutions",
  ]);
  const normalize = (s: string): string =>
    s.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-z0-9]/g, " ")
      .trim();
  const normName = normalize(name);
  const normDomain = normalize(domain).replace(/\s/g, "");
  const tokens = normName.split(/\s+/).filter(t => t.length >= 4 && !STOPWORDS.has(t));
  if (tokens.length === 0) {
    // Nom court : prends le nom complet (ex: "ABB", "ELIS")
    const shortName = normName.replace(/\s/g, "");
    return shortName.length >= 3 && normDomain.includes(shortName);
  }
  // Au moins un token significatif present dans le domain
  return tokens.some(t => normDomain.includes(t));
}

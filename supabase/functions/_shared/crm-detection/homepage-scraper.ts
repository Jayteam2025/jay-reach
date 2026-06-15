// Fetch direct de la home + sous-pages cles (mentions-legales, privacy, contact)
// d'un domaine, recherche de signatures CRM dans le HTML.
//
// Plus rapide et fiable que BuiltWith (pas de challenge anti-bot, pas de proxy
// Apify). Couvre les CRMs avec presence web : trackers, forms, scripts integres.

import {
  HTML_PATTERNS,
  TEXT_PATTERNS,
  matchAllPatterns,
  matchNonCrm,
  type CrmName,
} from "./signatures.ts";

const PATHS_TO_SCAN = [
  "/",
  "/mentions-legales",
  "/legal",
  "/privacy",
  "/privacy-policy",
  "/politique-de-confidentialite",
  "/contact",
];

const USER_AGENT = "Mozilla/5.0 (compatible; JayCrmDetect/1.0; +https://jay-assistant.fr)";
const FETCH_TIMEOUT_MS = 8000;

export type HtmlScanResult = {
  matched_crms: { crm: CrmName; source: "html" | "text"; evidence: string; path: string }[];
  marketing_tools: { tool: string; category: string }[];
  pages_scanned: { path: string; status: number; bytes: number }[];
};

async function fetchPage(url: string): Promise<{ html: string; status: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const html = await res.text();
    return { html, status: res.status };
  } catch {
    return null;
  }
}

/**
 * Fetch home + pages legales et detecte les CRMs via patterns HTML/texte.
 */
export async function scanHomepageForCrm(domain: string): Promise<HtmlScanResult> {
  const result: HtmlScanResult = {
    matched_crms: [],
    marketing_tools: [],
    pages_scanned: [],
  };

  // Ordre : home d'abord, puis pages legales en parallele si home OK
  const homeUrl = `https://${domain}/`;
  const homeRes = await fetchPage(homeUrl);
  if (!homeRes) {
    // Tente sans https (rare mais utile pour certains)
    const httpRes = await fetchPage(`http://${domain}/`);
    if (!httpRes) return result;
    result.pages_scanned.push({ path: "/", status: httpRes.status, bytes: httpRes.html.length });
    scanHtml(httpRes.html, "/", result);
  } else {
    result.pages_scanned.push({ path: "/", status: homeRes.status, bytes: homeRes.html.length });
    scanHtml(homeRes.html, "/", result);
  }

  // Pages legales / contact en parallele (timeout court chacune)
  const otherPaths = PATHS_TO_SCAN.slice(1);
  const subResults = await Promise.allSettled(
    otherPaths.map((path) => fetchPage(`https://${domain}${path}`)),
  );
  for (let i = 0; i < otherPaths.length; i++) {
    const path = otherPaths[i];
    const settled = subResults[i];
    if (settled.status !== "fulfilled" || !settled.value) continue;
    const { html, status } = settled.value;
    if (status >= 400) continue; // 404 = pas la page, on skip
    result.pages_scanned.push({ path, status, bytes: html.length });
    scanHtml(html, path, result);
  }

  // Dedupe par (crm, source)
  const seen = new Set<string>();
  result.matched_crms = result.matched_crms.filter((m) => {
    const k = `${m.crm}|${m.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return result;
}

function scanHtml(html: string, path: string, result: HtmlScanResult): void {
  const lower = html.toLowerCase();

  // Patterns HTML (scripts, trackers, forms)
  for (const m of matchAllPatterns(HTML_PATTERNS, lower)) {
    result.matched_crms.push({ crm: m.crm, source: "html", evidence: m.pattern, path });
  }

  // Texte : on extrait juste le texte visible (heuristique : enleve <script>/<style>)
  const visibleText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  for (const m of matchAllPatterns(TEXT_PATTERNS, visibleText)) {
    result.matched_crms.push({ crm: m.crm, source: "text", evidence: m.pattern, path });
  }

  // Marketing tools (non-CRM) — au cas ou (souvent dans les script src)
  result.marketing_tools.push(...matchNonCrm(lower));
}

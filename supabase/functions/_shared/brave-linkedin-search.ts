/**
 * Brave Search LinkedIn & Social Profiles Utility
 * Shared utility for Supabase Edge Functions to:
 * - Search for LinkedIn profiles by role + company
 * - Find contact names and titles from LinkedIn
 * - Locate Instagram/TikTok profiles for individuals
 */

export interface BraveSearchResult {
  url: string;
  title?: string;
  description?: string;
}

export interface LinkedInContact {
  name: string;
  linkedin_url: string;
  title?: string;
}

export interface CrossNetworkProfile {
  instagram_url?: string;
  tiktok_url?: string;
}

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  title?: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
}

/**
 * Generic Brave Search API wrapper
 * @param query Search query string
 * @param braveKey Brave Search API key from environment
 * @param count Number of results (default 5)
 * @returns Array of search results with URL, title, description
 */
export async function searchBrave(
  query: string,
  braveKey: string,
  count = 5
): Promise<BraveSearchResult[]> {
  try {
    const url = new URL(BRAVE_API_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", count.toString());

    const res = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": braveKey,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[brave-linkedin-search] Search error: ${res.status}`);
      return [];
    }

    const data: BraveSearchResponse = await res.json();
    return (data?.web?.results || []).map(
      (r: BraveWebResult) => ({
        url: r.url,
        title: r.title,
        description: r.description,
      })
    );
  } catch (err) {
    console.error("[brave-linkedin-search] Search error:", err);
    return [];
  }
}

/**
 * Parse LinkedIn profile name from result title
 * Typical format: "Prénom Nom - Titre | LinkedIn"
 * @param title Result title from Brave Search
 * @returns Extracted name or null
 */
function parseLinkedInName(title: string | undefined): string | null {
  if (!title) return null;

  // Remove "| LinkedIn" suffix
  let cleaned = title.replace(/\s*\|\s*LinkedIn\s*$/, "").trim();

  // Split on first occurrence of " - " or " – " or " | "
  const separators = [" - ", " – ", " | ", " | "];
  for (const sep of separators) {
    const idx = cleaned.indexOf(sep);
    if (idx > -1) {
      cleaned = cleaned.substring(0, idx).trim();
      break;
    }
  }

  return cleaned || null;
}

/**
 * Parse job title from LinkedIn result title
 * Typical format: "Prénom Nom - Titre | LinkedIn"
 * @param title Result title from Brave Search
 * @returns Extracted title or null
 */
function parseLinkedInTitle(title: string | undefined): string | null {
  if (!title) return null;

  // Remove "| LinkedIn" suffix
  let cleaned = title.replace(/\s*\|\s*LinkedIn\s*$/, "").trim();

  // Find position after first " - " or " – "
  const dashMatch = cleaned.match(/\s+[-–]\s+(.+?)(?:\s*\||$)/);
  if (dashMatch && dashMatch[1]) {
    return dashMatch[1].trim() || null;
  }

  return null;
}

/**
 * Extract the first quoted term from an OR query.
 * '"directeur commercial" OR "sales director"' → 'directeur commercial'
 */
function extractFirstQuotedTerm(roleQuery: string): string {
  const match = roleQuery.match(/"([^"]+)"/);
  return match ? match[1] : roleQuery.replace(/"/g, "").trim();
}

/**
 * Normalize LinkedIn URL: convert locale subdomains (fr.linkedin.com) to www.linkedin.com
 */
function normalizeLinkedInUrl(url: string): string {
  return url.replace(/^https?:\/\/[a-z]{2}\.linkedin\.com\//, "https://www.linkedin.com/");
}

/**
 * Normalize text for fuzzy matching: lowercase, strip accents, strip common suffixes
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/\b(sas|sa|sarl|eurl|sasu|group|groupe|france|international|holding)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize company name for Brave query: Title Case, strip dots/noise
 * "BRETAGNE MATERIAUX" → "Bretagne Materiaux"
 * "POINT.P" → "Point P"
 */
function normalizeCompanyForQuery(name: string): string {
  return name
    .replace(/\./g, " ")  // POINT.P → POINT P
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Check if a Brave result (title + description) mentions the target company.
 * Uses normalized fuzzy matching.
 */
function resultMatchesCompany(
  result: BraveSearchResult,
  companyName: string
): boolean {
  const normalizedCompany = normalizeForMatch(companyName);
  const companyWords = normalizedCompany.split(" ").filter(w => w.length > 2);

  const haystack = normalizeForMatch(
    `${result.title || ""} ${result.description || ""}`
  );

  // Full company name match
  if (haystack.includes(normalizedCompany)) return true;

  // At least 2 significant words match (for multi-word company names)
  if (companyWords.length >= 2) {
    const matchCount = companyWords.filter(w => haystack.includes(w)).length;
    if (matchCount >= 2) return true;
  }

  // Single-word company: must match exactly
  if (companyWords.length === 1 && haystack.includes(companyWords[0])) {
    return true;
  }

  return false;
}

/**
 * Find a SINGLE LinkedIn contact for a specific role at a company
 * @param roleQuery Role/title to search for (e.g., "Directeur Commercial")
 * @param companyName Company name
 * @param braveKey Brave Search API key
 * @returns First LinkedIn profile found or null
 */
export async function findLinkedInContact(
  roleQuery: string,
  companyName: string,
  braveKey: string
): Promise<LinkedInContact | null> {
  try {
    const normalizedCompany = normalizeCompanyForQuery(companyName);

    // Extract simple keywords from roleQuery for fallback
    // e.g. '"directeur commercial" OR "sales director"' → "directeur commercial"
    const simpleRole = extractFirstQuotedTerm(roleQuery);

    // Multiple query strategies — Brave handles simple queries better than complex OR
    const queries = [
      `(${roleQuery}) "${normalizedCompany}" site:linkedin.com/in/`,
      `"${normalizedCompany}" ${simpleRole} site:linkedin.com/in/`,
      `"${normalizedCompany}" ${simpleRole} linkedin`,
    ];

    for (const query of queries) {
      console.log(`[brave-linkedin-search] Query: ${query}`);
      const results = await searchBrave(query, braveKey, 10);
      console.log(`[brave-linkedin-search] → ${results.length} raw results`);

      for (const result of results) {
        if (!result.url.includes("linkedin.com/in/")) continue;

        if (!resultMatchesCompany(result, companyName)) {
          console.log(`[brave-linkedin-search] SKIP (company mismatch): ${result.title}`);
          continue;
        }

        const cleanUrl = normalizeLinkedInUrl(result.url.split("?")[0]);
        const name = parseLinkedInName(result.title);
        const title = parseLinkedInTitle(result.title);

        if (!name) continue;

        console.log(`[brave-linkedin-search] MATCH: ${name} — ${title} @ ${companyName}`);
        return {
          name,
          linkedin_url: cleanUrl,
          title: title || undefined,
        };
      }
    }

    console.log(`[brave-linkedin-search] No matching contact found for ${companyName}`);
    return null;
  } catch (err) {
    console.error("[brave-linkedin-search] findLinkedInContact error:", err);
    return null;
  }
}

/**
 * Find MULTIPLE LinkedIn contacts for a role at a company
 * Deduplicates by URL
 * @param roleQuery Role/title to search for (e.g., "Commerciaux terrain")
 * @param companyName Company name
 * @param braveKey Brave Search API key
 * @param maxResults Max results to return (default 20)
 * @returns Array of LinkedIn profiles, deduplicated by URL
 */
export async function findLinkedInContacts(
  roleQuery: string,
  companyName: string,
  braveKey: string,
  maxResults = 20
): Promise<LinkedInContact[]> {
  try {
    const normalizedCompany = normalizeCompanyForQuery(companyName);
    const simpleRole = extractFirstQuotedTerm(roleQuery);
    const contacts: LinkedInContact[] = [];
    const seenUrls = new Set<string>();

    const queries = [
      `(${roleQuery}) "${normalizedCompany}" site:linkedin.com/in/`,
      `"${normalizedCompany}" ${simpleRole} site:linkedin.com/in/`,
      `"${normalizedCompany}" ${simpleRole} linkedin`,
    ];

    for (const query of queries) {
      if (contacts.length >= maxResults) break;

      console.log(`[brave-linkedin-search] Query (multi): ${query}`);
      const results = await searchBrave(query, braveKey, Math.min(maxResults * 2, 20));

      for (const result of results) {
        if (contacts.length >= maxResults) break;
        if (!result.url.includes("linkedin.com/in/")) continue;

        const cleanUrl = normalizeLinkedInUrl(result.url.split("?")[0]);
        if (seenUrls.has(cleanUrl)) continue;
        seenUrls.add(cleanUrl);

        if (!resultMatchesCompany(result, companyName)) {
          console.log(`[brave-linkedin-search] SKIP (company mismatch): ${result.title}`);
          continue;
        }

        const name = parseLinkedInName(result.title);
        const title = parseLinkedInTitle(result.title);
        if (!name) continue;

        console.log(`[brave-linkedin-search] MATCH: ${name} — ${title} @ ${companyName}`);
        contacts.push({ name, linkedin_url: cleanUrl, title: title || undefined });
      }
    }

    console.log(`[brave-linkedin-search] Found ${contacts.length} matching contacts for ${companyName}`);
    return contacts;
  } catch (err) {
    console.error("[brave-linkedin-search] findLinkedInContacts error:", err);
    return [];
  }
}

/**
 * Find Instagram + TikTok profiles for a person
 * @param firstName Person's first name
 * @param lastName Person's last name
 * @param companyName Company name (optional, helps narrow search)
 * @param braveKey Brave Search API key
 * @returns Cross-network profile with Instagram and/or TikTok URLs
 */
export async function findSocialProfiles(
  firstName: string,
  lastName: string,
  companyName: string | undefined,
  braveKey: string
): Promise<CrossNetworkProfile> {
  const result: CrossNetworkProfile = {};

  // Instagram search
  try {
    const instagramQuery = `"${firstName} ${lastName}" ${
      companyName ? `"${companyName}"` : ""
    } site:instagram.com`.trim();
    const instagramResults = await searchBrave(instagramQuery, braveKey, 5);
    const instagramUrl = instagramResults
      .find((r) => r.url.includes("instagram.com/"))
      ?.url.split("?")[0]; // Remove query params
    if (instagramUrl) {
      result.instagram_url = instagramUrl;
      console.info(
        `[brave-linkedin-search] Found Instagram: ${instagramUrl}`
      );
    }
  } catch (err) {
    console.error("[brave-linkedin-search] Instagram search error:", err);
  }

  // TikTok search
  try {
    const tiktokQuery = `"${firstName} ${lastName}" site:tiktok.com`;
    const tiktokResults = await searchBrave(tiktokQuery, braveKey, 5);
    const tiktokUrl = tiktokResults
      .find((r) => r.url.includes("tiktok.com/"))
      ?.url.split("?")[0];
    if (tiktokUrl) {
      result.tiktok_url = tiktokUrl;
      console.info(`[brave-linkedin-search] Found TikTok: ${tiktokUrl}`);
    }
  } catch (err) {
    console.error("[brave-linkedin-search] TikTok search error:", err);
  }

  return result;
}

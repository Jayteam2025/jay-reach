/**
 * Resolution d'une entreprise via POST /company/search de FullEnrich.
 *
 * Probleme resolu : sur les noms approximatifs (Saint-Laurent vs YSL,
 * Nissan France vs Nissan Motor Co., CCEP vs Coca-Cola European Partners),
 * /people/search avec current_company_names retourne 0 contacts car l'index
 * FullEnrich indexe sous le nom canonique. En resolvant d'abord le nom vers
 * l'ID FullEnrich, on debloque ~60% des grandes boites qui retournaient zero.
 *
 * Cascade interne (du plus precis au plus large) :
 *   1. linkedin URL entreprise -> professional_network_urls (exact)
 *   2. domaine -> domains (exact)
 *   3. nom + filtre HQ FR -> names (exact)
 *   4. nom fuzzy + filtre HQ FR -> names (exact_match: false)
 *   5. nom fuzzy sans filtre pays -> dernier recours
 *
 * Cache : enrichment_cache (cache_type='fullenrich_company') TTL 30 jours.
 * Cle = lower(name) + '|' + (country_code || 'any'). Une entreprise ne
 * change pas de nom canonique souvent, donc cache long.
 *
 * Doc : https://docs.fullenrich.com/api/v2/company/search/post
 */

import { fetchFullEnrich, FULLENRICH_BASE_URL, FullEnrichError } from "./fullenrich.ts";
import type { LLMHandle } from "./providers/types.ts";

export interface ResolvedCompany {
  /** UUID FullEnrich. A utiliser comme current_company_ids dans /people/search. */
  id: string;
  /** Nom canonique tel qu'indexe par FullEnrich (ex: "Yves Saint Laurent SAS"). */
  name: string;
  /** Domaine principal (ex: "ysl.com"). Utile pour deduction email + Bouncer. */
  domain: string | null;
  /** Ville HQ FullEnrich. Utile comme person_locations dans la cascade /people/search. */
  hq_city: string | null;
  /** Code pays HQ ISO 3166-1 alpha-2 (ex: "FR"). */
  hq_country_code: string | null;
  /** Nombre d'employes (range agrege FullEnrich). */
  headcount: number | null;
  /** Industrie principale. */
  industry: string | null;
  /** ID LinkedIn (professional_network) si dispo. */
  professional_network_id: number | null;
  /** URL LinkedIn entreprise si dispo. */
  professional_network_url: string | null;
  /** Score de match du résolveur (scoreCandidate) : sim + pays + effectif − malus TLD. 0 si pas de match. */
  match_score: number;
}

export interface ResolveHints {
  /** Domaine connu (ex: extrait du site de l'annonce scrapee). */
  domain?: string | null;
  /** URL LinkedIn entreprise connue. */
  linkedin_url?: string | null;
  /** Code pays prioritaire (par defaut "FR" car cible FR). */
  country_code?: string | null;
  /**
   * LLM actif du workspace (LLMHandle) pour generer des alias intelligents
   * quand la cascade statique echoue. Optionnel : si null, on skip ce
   * dernier recours.
   * Utile pour : "Coca-Cola European Partners" -> "Coca-Cola Entreprise" (FR),
   * "Geopost" -> "DPDgroup", etc.
   */
  llm?: LLMHandle | null;
}

// Reponse partielle FullEnrich /company/search. On declare juste ce qu'on lit.
interface FullEnrichCompanySearchResponse {
  companies?: Array<{
    id?: string;
    name?: string;
    domain?: string;
    headcount?: number;
    locations?: {
      headquarters?: {
        city?: string;
        country?: string;
        country_code?: string;
      };
    };
    social_profiles?: {
      professional_network?: {
        id?: number;
        url?: string;
        handle?: string;
      };
    };
    industry?: {
      main_industry?: string;
    };
  }>;
  metadata?: {
    total?: number;
    credits?: number;
  };
}

interface SearchFilter {
  value: string | number;
  exact_match?: boolean;
  exclude?: boolean;
}

interface CompanySearchBody {
  names?: SearchFilter[];
  domains?: SearchFilter[];
  professional_network_urls?: SearchFilter[];
  professional_network_ids?: SearchFilter[];
  headquarters_locations?: SearchFilter[];
  limit?: number;
}

const CACHE_TYPE = "fullenrich_company";
const CACHE_TTL_DAYS = 30;

/**
 * Cache key normalisee. country_code permet de differencier les boites
 * homonymes selon le pays (ex : "Atlas" en France vs aux USA).
 */
function cacheKey(name: string, countryCode: string | null): string {
  const normalizedName = name.trim().toLowerCase();
  const country = (countryCode || "any").toLowerCase();
  return `${normalizedName}|${country}`;
}

/**
 * Lookup en cache. Retourne null si miss ou expired.
 */
async function getCached(
  supabase: SupabaseLike,
  key: string,
): Promise<ResolvedCompany | null> {
  try {
    const { data, error } = await supabase
      .from("enrichment_cache")
      .select("data, expires_at")
      .eq("cache_type", CACHE_TYPE)
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
    return data.data as ResolvedCompany;
  } catch (err) {
    console.warn(`[fullenrich-resolve] cache lookup failed: ${(err as Error).message}`);
    return null;
  }
}

async function setCached(
  supabase: SupabaseLike,
  key: string,
  value: ResolvedCompany,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400 * 1000).toISOString();
    await supabase
      .from("enrichment_cache")
      .upsert(
        { cache_type: CACHE_TYPE, cache_key: key, data: value, expires_at: expiresAt },
        { onConflict: "cache_type,cache_key" },
      );
  } catch (err) {
    console.warn(`[fullenrich-resolve] cache write failed: ${(err as Error).message}`);
  }
}

/**
 * Cache negatif court (24h) : si on n'a vraiment rien trouve, on evite de
 * re-payer un call /company/search a chaque tentative pendant les prochaines
 * 24h. Mais TTL court car la boite peut etre ajoutee a l'index FE entre temps.
 */
const NEGATIVE_CACHE_TTL_HOURS = 24;
const NEGATIVE_SENTINEL: ResolvedCompany = {
  id: "__not_found__",
  name: "",
  domain: null,
  hq_city: null,
  hq_country_code: null,
  headcount: null,
  industry: null,
  professional_network_id: null,
  professional_network_url: null,
  match_score: 0,
};

// ─── AI variants : cache + Claude call ───────────────────────────
const AI_VARIANTS_CACHE_TYPE = "fullenrich_ai_variants";
const AI_VARIANTS_CACHE_TTL_DAYS = 30;

async function getCachedAIVariants(supabase: SupabaseLike, key: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("enrichment_cache")
      .select("data, expires_at")
      .eq("cache_type", AI_VARIANTS_CACHE_TYPE)
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
    const payload = data.data as { variants?: string[] };
    return Array.isArray(payload?.variants) ? payload.variants : null;
  } catch {
    return null;
  }
}

async function setCachedAIVariants(supabase: SupabaseLike, key: string, variants: string[]): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + AI_VARIANTS_CACHE_TTL_DAYS * 86400 * 1000).toISOString();
    await supabase.from("enrichment_cache").upsert(
      {
        cache_type: AI_VARIANTS_CACHE_TYPE,
        cache_key: key,
        data: { variants },
        expires_at: expiresAt,
      } as Record<string, unknown>,
      { onConflict: "cache_type,cache_key" },
    );
  } catch (err) {
    console.warn(`[fullenrich-resolve] AI variants cache write failed: ${(err as Error).message}`);
  }
}

/**
 * Demande a Claude Haiku 1-3 alias plausibles pour un nom d'entreprise donne.
 * Utile pour resoudre les acronymes / sous-marques locales non-evidents :
 *   - "Coca-Cola European Partners" -> ["Coca-Cola Entreprise", "CCEP France"]
 *   - "CCEP" -> ["Coca-Cola European Partners", "Coca-Cola Entreprise"]
 *   - "Geopost" -> ["DPDgroup", "Chronopost"]
 *
 * Cache 30 jours via enrichment_cache (les marques bougent peu).
 * Retourne [] si Claude fail ou ne connait pas (pas de hallucination).
 */
async function generateAIVariants(
  supabase: SupabaseLike,
  llm: LLMHandle,
  name: string,
  countryCode: string,
): Promise<string[]> {
  const cacheKey = `${name.trim().toLowerCase()}|${countryCode.toLowerCase()}`;

  const cached = await getCachedAIVariants(supabase, cacheKey);
  if (cached !== null) {
    console.log(`[fullenrich-resolve] AI variants cache hit for "${name}": [${cached.join(", ")}]`);
    return cached;
  }

  try {
    const country = countryCode === "FR" ? "France" : countryCode;
    const prompt = `Company name: "${name}"
Country target: ${country}

Task: List 1-3 ALTERNATE names this same company may be indexed under on LinkedIn or B2B databases. Include:
- Local subsidiary name in ${country} (ex: "Coca-Cola European Partners" -> "Coca-Cola Entreprise" in France)
- Common acronym (ex: "Coca-Cola European Partners" -> "CCEP")
- Legal name / parent brand (ex: "Geopost" -> "DPDgroup")
- **OPERATIONAL ENTITY when input is a holding/group** : if input starts with "Groupe", "Group", or contains words like "Holding", suggest the actual company where employees work. Examples :
  - "Groupe Figaro" -> "Le Figaro" (the operating newspaper, where most employees are listed on LinkedIn)
  - "Groupe Bayard" -> "Bayard Presse" (the operational entity)
  - "Groupe Le Monde" -> "Le Monde" (the newspaper itself, not the holding)
  - "TX Group" -> "Tamedia" or "20 Minuten" (subsidiaries with most employees)
  - "Groupe Rossel" -> "Rossel & Cie" or "Le Soir"

Rules:
- DO NOT include the input name itself
- Suggest variants even if not 100% sure - LinkedIn often indexes under operational names rather than holdings. Better to suggest than miss.
- Each alternate must be a plausible, verifiable company name
- No suffixes like "SAS", "SARL", "Inc"

Return strict JSON: {"variants": ["...", "..."]}`;

    // Promise.race timeout 10s : si Claude hang, on coupe et retourne []
    // -> caller continue sans variants IA (degradation gracieuse, pas de crash).
    const callPromise = llm.provider.complete({
      tier: "fast",
      system: "",
      user: prompt,
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 512, // marge pour le JSON indenté (évite la troncature)
    }, llm.context);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Claude AI variants timeout 10s")), 10_000)
    );
    const result = await Promise.race([callPromise, timeoutPromise]);

    // Claude peut entourer le JSON de ```json ... ``` — strippe défensivement
    let jsonText = result.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonText);
    const variants = Array.isArray(parsed.variants)
      ? parsed.variants.filter((v: unknown): v is string => typeof v === "string" && v.trim().length >= 2).map((v: string) => v.trim()).slice(0, 3)
      : [];

    console.log(`[fullenrich-resolve] AI variants generated for "${name}": [${variants.join(", ")}]`);
    await setCachedAIVariants(supabase, cacheKey, variants);
    return variants;
  } catch (err) {
    console.warn(`[fullenrich-resolve] Claude AI variants error: ${(err as Error).message}`);
    return [];
  }
}

async function setNegativeCached(supabase: SupabaseLike, key: string): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + NEGATIVE_CACHE_TTL_HOURS * 3600 * 1000).toISOString();
    await supabase
      .from("enrichment_cache")
      .upsert(
        { cache_type: CACHE_TYPE, cache_key: key, data: NEGATIVE_SENTINEL, expires_at: expiresAt },
        { onConflict: "cache_type,cache_key" },
      );
  } catch (err) {
    console.warn(`[fullenrich-resolve] negative cache write failed: ${(err as Error).message}`);
  }
}

function mapCompanyResult(c: NonNullable<FullEnrichCompanySearchResponse["companies"]>[number]): ResolvedCompany | null {
  if (!c.id) return null;
  return {
    id: c.id,
    name: c.name || "",
    domain: c.domain || null,
    hq_city: c.locations?.headquarters?.city || null,
    hq_country_code: c.locations?.headquarters?.country_code || null,
    headcount: typeof c.headcount === "number" ? c.headcount : null,
    industry: c.industry?.main_industry || null,
    professional_network_id: c.social_profiles?.professional_network?.id ?? null,
    professional_network_url: c.social_profiles?.professional_network?.url || null,
    match_score: 0, // Will be populated after scoring
  };
}

// ─── Similarity gate ─────────────────────────────────────────────
// Sert a rejeter les candidats /company/search dont le nom est trop
// different de l'input. Sans ce filtre, "Alpine (Renault)" matche
// "CLUB ALPINE RENAULT SPORTIVE" (un fan club a Bastia) et on perd la
// vraie Alpine. De meme pour Dacia (Renault) qui matche un
// concessionnaire local "Renault - Dacia Gap Automobiles".

// Mots vides + termes juridiques + termes geo : on les strip avant de
// comparer pour ne pas etre trompe par des suffixes administratifs.
const STOP_WORDS = new Set([
  "the", "le", "la", "les", "un", "une", "des", "de", "du", "et", "and", "by", "of", "for",
  // Suffixes juridiques
  "sa", "sas", "sasu", "sarl", "eurl", "snc", "scop", "ag", "gmbh", "ltd", "limited", "inc",
  "llc", "plc", "kg", "ohg", "kgaa", "ab", "oy", "bv", "nv", "spa", "srl", "co", "company", "corporation", "corp",
  // Termes geo (on veut Saint-Laurent == Saint Laurent peu importe le pays)
  "france", "francaise", "francais", "belgium", "belgique", "germany", "deutschland",
  "uk", "usa", "us", "canada", "europe", "european", "international", "global", "world", "worldwide",
  // Mots vagues
  "group", "groupe", "holding", "holdings", "industries", "services", "consulting", "solutions",
  "agency", "studio", "studios", "labs", "lab", "tech", "technologies", "technology",
  "by", "partners", "partner",
]);

function tokenizeName(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-z0-9+]+/g, " ") // garde + pour Mann+Hummel
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t)),
  );
}

/**
 * Jaccard similarity sur tokens normalises. 1.0 = parfait, 0.0 = aucun token commun.
 * Seuil empirique 0.5 (50%) :
 *   - "Saint-Laurent" vs "Saint Laurent" -> 1.0 (garde)
 *   - "Bonduelle" vs "Bonduelle" -> 1.0 (garde)
 *   - "Mann+Hummel" vs "MANN+HUMMEL" -> 1.0 (garde)
 *   - "FCM Travel France" vs "FCM Travel France" -> 1.0 (garde, "france" stripped des 2)
 *   - "Alpine (Renault)" vs "CLUB ALPINE RENAULT SPORTIVE" -> 2/4=0.5 (limite, on garde mais
 *     le multi-candidates choisira un meilleur match s'il existe)
 *   - "Alpine (Renault)" vs "Alpine" -> 1.0 (garde, super match)
 *   - "Dacia (Renault)" vs "Renault Dacia Gap Automobiles" -> 2/4=0.5 (limite)
 *   - "efficy" vs "Efficience IT" -> 0/2 = 0 (skip, faux match)
 *   - "Equans Services" vs "Equans Services Canada US" -> 1.0 (garde, geo stripped)
 */
function nameSimilarity(input: string, candidate: string): number {
  const a = tokenizeName(input);
  const b = tokenizeName(candidate);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const SIMILARITY_THRESHOLD = 0.5;

/**
 * Genere des variantes de nom pour augmenter le taux de match cote FE :
 *   - Original
 *   - Strip parens : "Dacia (Renault)" -> "Dacia"
 *   - Strip slash : "Geopost / Chronopost" -> "Geopost" + "Chronopost"
 *   - Strip suffix geo simple : "Ferrero France" -> "Ferrero" (uniquement si
 *     ca laisse un nom signifiant)
 * Retourne tjr l'original en 1er + uniques.
 */
export function generateNameVariants(name: string): string[] {
  const variants = new Set<string>();
  const trimmed = name.trim();
  if (!trimmed) return [];
  variants.add(trimmed);

  // Strip parens (et leur contenu) : "Dacia (Renault)" -> "Dacia"
  const noParens = trimmed.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (noParens && noParens !== trimmed) variants.add(noParens);

  // Strip slash : "Geopost / Chronopost" -> 2 variantes
  if (trimmed.includes("/")) {
    for (const part of trimmed.split("/")) {
      const t = part.trim();
      if (t && t.length >= 2) variants.add(t);
    }
  }

  // Strip suffix geographique simple type "X France", "X Services" :
  // seulement si le nom resultant est >= 3 chars et != original
  const suffixes = ["France", "Services", "Group", "Groupe", "Holdings", "Holding", "Agency", "Company"];
  for (const s of suffixes) {
    const re = new RegExp(`\\s+${s}$`, "i");
    if (re.test(trimmed)) {
      const stripped = trimmed.replace(re, "").trim();
      if (stripped.length >= 3) variants.add(stripped);
    }
  }

  // Strip PREFIX holding/article : "Groupe Figaro" -> "Figaro", "Le Monde" ->
  // "Monde", "The Bayard Group" -> "Bayard". Permet de retrouver l'entite
  // operationnelle quand FE indexe sous le nom court (Le Figaro SA, Bayard
  // Presse, Tamedia) au lieu du nom holding (Groupe Figaro, Groupe Bayard,
  // TX Group). Nb : on garde aussi l'original dans les variants, donc si
  // "Groupe Figaro" est le bon nom indexe, on le trouve via cette voie aussi.
  const prefixes = ["Groupe", "Group", "The", "Le", "La", "Les"];
  for (const p of prefixes) {
    const re = new RegExp(`^${p}\\s+`, "i");
    if (re.test(trimmed)) {
      const stripped = trimmed.replace(re, "").trim();
      if (stripped.length >= 3) variants.add(stripped);
    }
  }

  return [...variants];
}

/**
 * Score qualite d'un candidat : combine similarity, country match, headcount.
 * Sert au ranking final cross-cascade. Plus eleve = meilleur.
 *
 * Composantes :
 *   - similarity (0-1) : poids 0.5
 *   - country match prefere : poids 0.25 (bool 0/1)
 *   - headcount log : poids 0.15 (0 a 1 sur log10 plage 1-100000)
 *   - malus domain pays-specifique non aligne : -0.2
 *     ex: domain .nl/.be/.us avec country FR attendu = -0.2
 *     evite les concessionnaires/distributeurs locaux (Zeeuw NL, Alpine BE)
 *   - bonus headcount >= 500 : +0.05
 */
function scoreCandidate(
  c: ResolvedCompany,
  inputName: string | string[],
  preferredCountryCode: string | null,
): number {
  // Sim = max sur la liste de noms d'entree. Utile pour la cascade IA : on
  // compare avec l'input ORIGINAL + les variants IA ; un candidat
  // matchant un variant IA est valide meme s'il ne matche pas l'input.
  // Ex: "Renault Group" matche le variant IA mais pas l'input "Dacia
  // (Renault)" -> sim de l'array = max(0.5, 1.0) = 1.0 → accepté.
  const inputs = Array.isArray(inputName) ? inputName : [inputName];
  const sim = Math.max(...inputs.map(n => nameSimilarity(n, c.name)));
  let score = sim * 0.5;

  if (preferredCountryCode && c.hq_country_code === preferredCountryCode) {
    score += 0.25;
  }

  // Headcount log scale (1 employe -> 0, 100k -> ~1)
  if (c.headcount && c.headcount > 0) {
    score += Math.min(Math.log10(c.headcount) / 5, 1) * 0.15;
    if (c.headcount >= 500) score += 0.05;
  }

  // Malus domain pays-specifique non aligne avec le pays attendu
  // (filtre concessionnaires/distributeurs locaux)
  if (preferredCountryCode && c.domain) {
    const tld = c.domain.split(".").pop()?.toLowerCase() || "";
    const countryTlds: Record<string, string> = {
      nl: "NL", be: "BE", us: "US", uk: "GB", de: "DE", es: "ES", it: "IT",
      pl: "PL", ch: "CH", at: "AT", pt: "PT", ie: "IE", se: "SE", dk: "DK", no: "NO",
    };
    const tldCountry = countryTlds[tld];
    if (tldCountry && tldCountry !== preferredCountryCode) {
      score -= 0.2;
    }
  }

  return score;
}

/**
 * Un appel /company/search avec un body donne. Retourne TOUS les candidats
 * acceptables, tries par score combine (sim + country + headcount + malus
 * domain pays). Le caller choisit le meilleur.
 *
 * Filtrage : on rejette les candidats dont la similarity de nom est < 0.5
 * (50% des tokens en commun apres normalisation). Evite que "Alpine (Renault)"
 * matche un fan club ou "efficy" matche "Efficience IT".
 */
async function callCompanySearch(
  apiKey: string,
  body: CompanySearchBody,
  preferredCountryCode: string | null,
  inputName: string | string[],
): Promise<Array<ResolvedCompany & { _score: number }>> {
  const res = await fetchFullEnrich(`${FULLENRICH_BASE_URL}/company/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, limit: body.limit ?? 10 }),
  });

  const payload = (await res.json().catch(() => ({}))) as FullEnrichCompanySearchResponse;

  if (!res.ok) {
    const errCode = (payload as { code?: string }).code || "fullenrich.company_search_failed";
    const errMsg = (payload as { message?: string }).message || `HTTP ${res.status}`;
    if (res.status === 404) return [];
    throw new FullEnrichError(errCode, `FullEnrich /company/search: ${errMsg}`, res.status);
  }

  const rawCandidates = (payload.companies || [])
    .map(mapCompanyResult)
    .filter((c): c is ResolvedCompany => c !== null);

  if (rawCandidates.length === 0) return [];

  // Sim = max sur les noms d'entree fournis (input + variants IA le
  // cas echeant). Permet d'accepter un candidat qui matche un variant meme
  // s'il ne matche pas l'input original.
  const inputs = Array.isArray(inputName) ? inputName : [inputName];
  const simOf = (c: ResolvedCompany) => Math.max(...inputs.map(n => nameSimilarity(n, c.name)));

  const filtered = rawCandidates.filter(c => simOf(c) >= SIMILARITY_THRESHOLD);

  if (filtered.length === 0) {
    const rejected = rawCandidates.slice(0, 3).map(c => `"${c.name}" sim=${simOf(c).toFixed(2)}`).join(", ");
    console.log(`[fullenrich-resolve] all candidates rejected by similarity (inputs=[${inputs.join("|")}]): ${rejected}`);
    return [];
  }

  const scored = filtered.map(c => ({ ...c, _score: scoreCandidate(c, inputName, preferredCountryCode) }));
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

/**
 * Interface minimale pour le client supabase utilise par le cache.
 * Permet de mocker en tests sans embarquer @supabase/supabase-js.
 */
export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): Promise<{ data: { data: unknown; expires_at: string | null } | null; error: unknown }>;
        };
      };
    };
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ): Promise<{ error: unknown }>;
  };
}

/**
 * True si le match résolu est un homonyme étranger à faible confiance :
 * HQ dans un pays ≠ cible ET score de match sous le seuil. Sert à éviter de
 * lancer (et payer) une recherche de contacts FullEnrich qui sera de toute
 * façon vidée par le post-filtre pays.
 */
export function isForeignNamesake(
  resolved: { hq_country_code: string | null; match_score: number } | null,
  targetCountry: string,
  threshold: number,
): boolean {
  return !!resolved
    && resolved.hq_country_code != null
    && resolved.hq_country_code !== targetCountry
    && resolved.match_score < threshold;
}

/**
 * Resout un nom d'entreprise vers son identite canonique FullEnrich.
 *
 * Strategie :
 *   - Si hint linkedin_url : un call exact (sequentiel, le plus precis)
 *   - Sinon si hint domain : un call exact (sequentiel)
 *   - Sinon : 3 cascades de nom EN PARALLELE
 *       a) name exact + headquarters_locations: FR
 *       b) name fuzzy + headquarters_locations: FR
 *       c) name fuzzy seul (dernier recours)
 *     Ordre de preference quand plusieurs matchent : (a) > (b) > (c).
 *
 * Pourquoi la parallelisation : FullEnrich /company/search prend 8-15s par
 * appel. En sequentiel, Saint-Laurent et Nissan France ne resolvaient qu'a
 * la 3eme cascade -> 30-45s total -> depassait le timeout 20s cote enrich-
 * company. En parallele, la latence cas pire = max(call) ~10-15s. Cout : 3x
 * plus de calls FE company_search mais ces calls sont quasi-gratuits
 * (verifie empiriquement : credits=0 sur les retours observes en prod).
 *
 * Retourne null si aucune cascade ne match (rare).
 *
 * Aucun throw sur les erreurs reseau : si tout fail, log et retourne null
 * pour que le caller fallback sur l'ancien comportement (current_company_names
 * direct dans /people/search).
 */
export async function resolveCompany(
  supabase: SupabaseLike,
  apiKey: string,
  companyName: string,
  hints: ResolveHints = {},
): Promise<ResolvedCompany | null> {
  const trimmedName = companyName.trim();
  if (!trimmedName) return null;

  const countryCode = hints.country_code ?? "FR";
  const key = cacheKey(trimmedName, countryCode);

  // 0. Cache hit
  const cached = await getCached(supabase, key);
  if (cached) {
    if (cached.id === NEGATIVE_SENTINEL.id) {
      console.log(`[fullenrich-resolve] cache hit (negative): "${trimmedName}"`);
      return null;
    }
    console.log(`[fullenrich-resolve] cache hit: "${trimmedName}" -> ${cached.name} (${cached.id})`);
    return cached;
  }

  let resolved: ResolvedCompany | null = null;
  let matchedVia = "";

  // Helper local : prend le 1er candidat acceptable d'une liste
  const firstOrNull = <T extends ResolvedCompany>(arr: T[]): T | null => arr[0] ?? null;

  // Variants du nom pour FE (Alpine (Renault) -> Alpine ; Geopost / Chronopost -> 2 ; etc.)
  const nameVariants = generateNameVariants(trimmedName);

  try {
    // 1. LinkedIn URL entreprise (sequentiel, c'est le hint le plus precis)
    if (!resolved && hints.linkedin_url) {
      const cands = await callCompanySearch(
        apiKey,
        { professional_network_urls: [{ value: hints.linkedin_url, exact_match: true }] },
        countryCode,
        trimmedName,
      );
      const candidate = firstOrNull(cands);
      if (candidate) {
        resolved = {
          ...candidate,
          match_score: candidate._score,
        };
        matchedVia = "linkedin_url";
      }
    }

    // 2. Domaine (sequentiel apres linkedin)
    if (!resolved && hints.domain) {
      const cands = await callCompanySearch(
        apiKey,
        { domains: [{ value: hints.domain, exact_match: true }] },
        countryCode,
        trimmedName,
      );
      const candidate = firstOrNull(cands);
      if (candidate) {
        resolved = {
          ...candidate,
          match_score: candidate._score,
        };
        matchedVia = "domain";
      }
    }

    // 3. Multi-name dans /company/search : on envoie TOUS les variants en
    // une seule requete (FE accepte un array `names`). Reduit drastiquement
    // les calls vs cascade nominale qu'on avait avant.
    // On fait 2 cascades en parallele :
    //   a) exact_match: false + headquarters_locations: FR (priorite locale)
    //   b) exact_match: false sans pays (capte les filiales avec HQ non-FR
    //      comme Mann+Hummel DE qui a des employes FR)
    // Le ranking final agreges'occupe de prioriser par score (sim, country, hc).
    if (!resolved && nameVariants.length > 0) {
      const fr = countryCode ? [{ value: countryCode }] : undefined;
      const namesPayload = nameVariants.map(v => ({ value: v, exact_match: false }));

      const fuzzyFr: CompanySearchBody = { names: namesPayload };
      if (fr) fuzzyFr.headquarters_locations = fr;
      const fuzzyAny: CompanySearchBody = { names: namesPayload };

      const [r1, r2] = await Promise.all([
        callCompanySearch(apiKey, fuzzyFr, countryCode, trimmedName).catch(() => []),
        callCompanySearch(apiKey, fuzzyAny, countryCode, trimmedName).catch(() => []),
      ]);

      // Aggregation : dedupe sur ID + tri par score combine (sim+country+hc-domain)
      const seen = new Set<string>();
      const allCandidates: Array<ResolvedCompany & { _score: number }> = [];
      for (const c of [...r1, ...r2]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          allCandidates.push(c);
        }
      }

      if (allCandidates.length > 0) {
        // Re-score globalement (on a deja un _score mais il faut le re-calculer
        // avec le contexte trimmedName cross-cascade pour homogeneite)
        const ranked = allCandidates
          .map(c => ({ ...c, _score: scoreCandidate(c, trimmedName, countryCode) }))
          .sort((a, b) => b._score - a._score);
        const best = ranked[0];
        resolved = {
          id: best.id, name: best.name, domain: best.domain,
          hq_city: best.hq_city, hq_country_code: best.hq_country_code,
          headcount: best.headcount, industry: best.industry,
          professional_network_id: best.professional_network_id,
          professional_network_url: best.professional_network_url,
          match_score: best._score,
        };
        matchedVia = `multi-name (variants=${nameVariants.length}, score=${best._score.toFixed(2)}, ${allCandidates.length} candidates)`;
      }
    }

    // 4. Dernier recours : alias intelligents via Claude.
    // Cas typique : "Coca-Cola European Partners" -> Claude propose
    // "Coca-Cola Entreprise" qui matche le vrai compte FR. On declenche
    // uniquement si la cascade nominale a echoue ou que le best score est
    // faible (< 0.55 = pas de match FR + faible similarity), pour eviter
    // les calls Claude inutiles sur les boites qui marchent.
    // Trigger Claude si :
    // - Pas de resolution OU
    // - Score < 0.55 (resolution faible) OU
    // - Headcount inconnu/petit (signal d'une fiche holding pauvre, cas
    //   "Groupe Figaro" -> GROUPE FIGARO avec 2 profils alors que Le Figaro
    //   SA a 1500+ employes operationnels) OU
    // - Domain manquant (fiche generique, pas operationnelle)
    const SCORE_THRESHOLD_FOR_AI_FALLBACK = 0.55;
    const HEADCOUNT_THRESHOLD_FOR_AI = 50;
    const bestScore = resolved ? scoreCandidate(resolved, trimmedName, countryCode) : 0;
    const lowHeadcount = resolved && (resolved.headcount === null || resolved.headcount < HEADCOUNT_THRESHOLD_FOR_AI);
    const missingDomain = resolved && !resolved.domain;
    const needsAI = hints.llm && (
      !resolved
      || bestScore < SCORE_THRESHOLD_FOR_AI_FALLBACK
      || lowHeadcount
      || missingDomain
    );
    if (needsAI) {
      console.log(`[fullenrich-resolve] cascade weak (resolved=${!!resolved} score=${resolved ? bestScore.toFixed(2) : "n/a"} headcount=${resolved?.headcount ?? "null"} domain=${resolved?.domain ?? "null"}), trying AI variants for "${trimmedName}"`);
      const aiVariants = await generateAIVariants(supabase, hints.llm!, trimmedName, countryCode);
      if (aiVariants.length > 0) {
        const aiPayload = aiVariants.map(v => ({ value: v, exact_match: false }));
        // Pour la cascade IA, on compare la similarity avec input + variants
        // IA. Sinon "Renault Group" propose par l'IA est rejete car
        // sim avec input "Dacia (Renault)" = 0.5 limite. Avec variants en
        // pool, sim avec "Renault Group" = 1.0 → accepte.
        const aiInputs = [trimmedName, ...aiVariants];
        try {
          // Cascade IA : on cherche SANS headquarters_locations strict, parce que
          // certaines entites FR n'ont pas leur HQ explicitement marque FR dans
          // l'index FE (ex: Coca-Cola Entreprise SAS, cokecce.fr -> indexe sans
          // country_code FR). Le scoring bonus FR + malus domain non-FR fera le
          // tri ensuite. On lance aussi avec FR en parallele au cas ou l'entite
          // est bien indexee FR (pour gagner sur le tiebreaker pays).
          const [aiCandsAny, aiCandsFr] = await Promise.all([
            callCompanySearch(apiKey, { names: aiPayload }, countryCode, aiInputs).catch(() => []),
            countryCode
              ? callCompanySearch(apiKey, { names: aiPayload, headquarters_locations: [{ value: countryCode }] }, countryCode, aiInputs).catch(() => [])
              : Promise.resolve([]),
          ]);
          const allAi = [...aiCandsAny, ...aiCandsFr];
          // Dedupe par id
          const seenIds = new Set<string>();
          const uniqueAi = allAi.filter(c => seenIds.has(c.id) ? false : (seenIds.add(c.id), true));

          if (uniqueAi.length > 0) {
            // Re-score avec input + variants IA pour homogeneite avec
            // le filtre similarity (qui a accepte les candidats matchant un
            // variant). Sinon "Renault Group" score=0 vs trimmedName seul.
            const scored = uniqueAi
              .map(c => ({ ...c, _score: scoreCandidate(c, aiInputs, countryCode) }))
              .sort((a, b) => b._score - a._score);
            const aiBest = scored[0];
            console.log(`[fullenrich-resolve] AI variants returned ${uniqueAi.length} candidates, best: "${aiBest.name}" score=${aiBest._score.toFixed(2)}`);
            // On garde le meilleur entre AI et cascade nominale
            if (!resolved || aiBest._score > bestScore) {
              resolved = {
                id: aiBest.id, name: aiBest.name, domain: aiBest.domain,
                hq_city: aiBest.hq_city, hq_country_code: aiBest.hq_country_code,
                headcount: aiBest.headcount, industry: aiBest.industry,
                professional_network_id: aiBest.professional_network_id,
                professional_network_url: aiBest.professional_network_url,
                match_score: aiBest._score,
              };
              matchedVia = `AI variant "${aiBest.name}" (score=${aiBest._score.toFixed(2)}, alias=[${aiVariants.join(",")}])`;
            }
          } else {
            console.log(`[fullenrich-resolve] AI variants returned no candidates for "${trimmedName}"`);
          }
        } catch (err) {
          console.warn(`[fullenrich-resolve] AI variants cascade failed: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[fullenrich-resolve] cascade failed for "${trimmedName}": ${(err as Error).message}`);
    return null;
  }

  if (resolved) {
    console.log(`[fullenrich-resolve] matched via ${matchedVia}: "${trimmedName}" -> ${resolved.name}`);
    await setCached(supabase, key, resolved);
  } else {
    console.log(`[fullenrich-resolve] no match: "${trimmedName}"`);
    await setNegativeCached(supabase, key);
  }

  return resolved;
}

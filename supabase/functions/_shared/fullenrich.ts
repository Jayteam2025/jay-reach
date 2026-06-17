/**
 * Client FullEnrich API v2
 *
 * Doc : https://docs.fullenrich.com/api/v2/general/introduction
 *
 * Flow :
 *   1. POST /contact/enrich/bulk avec une liste de contacts -> retourne enrichment_id
 *   2. GET  /contact/enrich/bulk/{id} en polling jusqu'a status === "FINISHED"
 *
 * Couverture EMEA annoncee : ~84% email, ~71% phone mobile.
 * Booster email +5-20%, mobile +10-60% quand on passe une linkedin_url.
 *
 * Conformite : SOC 2 Type II, GDPR, CCPA.
 */

import { z } from "npm:zod@3.24.1";

export const FULLENRICH_BASE_URL = "https://app.fullenrich.com/api/v2";

/**
 * Schéma de validation du callback webhook FullEnrich.
 *
 * On exige uniquement `id` (clé de l'enrichment job) ; le reste passe en passthrough
 * et est stocké tel quel. NE PAS typer `cost` en number : FullEnrich l'envoie comme
 * OBJET `{ credits }`, et `data` peut varier. L'ancien `cost: z.number()` rejetait le
 * vrai payload en 400 (bug #410) → bulk jamais persisté, retries FullEnrich en boucle.
 */
export const FullenrichWebhookRequestSchema = z.object({
  id: z.string(),
}).passthrough();

// =============================================================================
// Rate limiter — Token bucket persistant en DB
// =============================================================================
// FullEnrich limite a 60 req/min toutes routes confondues (search + bulk
// submit + bulk poll). Le rate limiter est centralise en Postgres (table
// fullenrich_rate_limit + RPC acquire_fullenrich_token) pour que la limite
// soit respectee CROSS-INSTANCE Deno : enrich-company spawn N workers en
// parallele dans des instances Deno distinctes, donc un bucket en memoire
// (singleton par instance) ne suffit pas — chaque instance aurait son propre
// bucket de 50 et la limite reelle FE serait depassee.
//
// Capacite : 50 tokens (marge 17% sous le quota FE de 60/min)
// Refill : 1 token / 1.2s en regime permanent
// Cf. migration 20260504160000_fullenrich_rate_limit.sql
async function acquireFullEnrichToken(): Promise<number> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    // Fallback : pas de rate limit en environnement de test sans env vars.
    // En prod ces deux vars sont toujours definies par Supabase Edge runtime.
    return 0;
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/acquire_fullenrich_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    // Si la RPC fail (DB down, RLS, etc.) on degrade plutot que de bloquer
    // tout le pipeline. Le rate limit FE peut etre hit mais c'est mieux que
    // de tout planter sur une erreur DB transitoire.
    console.warn(`[fullenrich] acquire_fullenrich_token HTTP ${res.status}, proceeding without rate limit`);
    return 0;
  }
  const waitMs = await res.json();
  return typeof waitMs === "number" ? waitMs : 0;
}

/**
 * Wrapper autour de fetch() qui consomme un token de la table DB avant chaque
 * appel FullEnrich. Garantit qu'on ne depasse jamais 50 req/min cross-instance.
 */
export async function fetchFullEnrich(input: string, init?: RequestInit): Promise<Response> {
  // Boucle d'attente jusqu'a obtenir un token. Cap a 60s d'attente cumulee
  // pour eviter un deadlock si la RPC retourne toujours wait_ms > 0.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const waitMs = await acquireFullEnrichToken();
    if (waitMs === 0) break;
    await new Promise(r => setTimeout(r, Math.min(waitMs, 5_000)));
  }
  return fetch(input, init);
}

export interface FullEnrichContactInput {
  first_name?: string;
  last_name?: string;
  company_name?: string;
  domain?: string;
  linkedin_url?: string;
  /**
   * Champs a enrichir. Par defaut : work_emails + phones.
   * NOTE : depuis 2026-04-23, "contact.emails" est remplace par
   * "contact.work_emails" (breaking change FullEnrich).
   */
  enrich_fields?: Array<"contact.work_emails" | "contact.phones" | "contact.personal_emails">;
  /** Cle custom (20 entrees max, values en string) pour retrouver le contact dans la reponse. */
  custom?: Record<string, string>;
}

export interface FullEnrichEmail {
  email: string;
  status?: string; // DELIVERABLE, CATCH_ALL, UNKNOWN, etc.
  type?: string;
}

export interface FullEnrichPhone {
  number: string;
  region?: string;
}

export interface FullEnrichContactInfo {
  most_probable_work_email?: FullEnrichEmail;
  most_probable_personal_email?: FullEnrichEmail;
  most_probable_phone?: FullEnrichPhone;
  work_emails?: FullEnrichEmail[];
  personal_emails?: FullEnrichEmail[];
  phones?: FullEnrichPhone[];
}

export interface FullEnrichProfile {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  location?: {
    country?: string;
    country_code?: string;
    city?: string;
    region?: string;
  };
  social_profiles?: {
    /** Depuis 2026-04-23, FullEnrich a renomme "linkedin" en "professional_network". */
    professional_network?: {
      url?: string;
      handle?: string;
      connection_count?: number;
    };
  };
  employment?: {
    current?: {
      title?: string;
      is_current?: boolean;
      start_at?: string;
      company?: {
        id?: string;
        name?: string;
        domain?: string;
        description?: string;
        year_founded?: number;
        headcount?: number;
      };
    };
  };
  skills?: string[];
  languages?: Array<{ language?: string; code?: string; proficiency?: string }>;
}

export interface FullEnrichContactResult {
  input: FullEnrichContactInput;
  custom?: Record<string, string>;
  contact_info?: FullEnrichContactInfo;
  profile?: FullEnrichProfile;
}

export interface FullEnrichJobResult {
  id: string;
  name: string;
  status: "IN_PROGRESS" | "PROCESSING" | "FINISHED" | "ERROR";
  cost?: { credits?: number };
  data: FullEnrichContactResult[];
}

export class FullEnrichError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Detecte si une erreur vient d'un credits FullEnrich epuise.
 * Doc : HTTP 402 Payment Required = "Account balance insufficient".
 * Utilise cote enrich-company pour kill le job et arreter la chain de workers.
 */
export function isCreditsExhaustedError(err: unknown): boolean {
  return err instanceof FullEnrichError && err.status === 402;
}

/**
 * Cree un job d'enrichissement en bulk. Retourne l'enrichment_id.
 *
 * @param contacts - Liste des contacts. Chaque contact doit avoir soit
 *   (first_name + last_name + domain/company_name) soit (linkedin_url).
 *   Pour maximiser les matches, passer linkedin_url + first_name + last_name + company_name.
 */
export interface SubmitBulkOptions {
  /**
   * URL ou FullEnrich POST le payload final quand le job est FINISHED.
   * Format identique au GET /contact/enrich/bulk/{id}. Permet d'eviter le
   * polling cote consummateur, qui mange le rate limit FullEnrich (60/min).
   * Doc : https://docs.fullenrich.com/api/v2/general/webhooks
   */
  webhookUrl?: string;
}

export async function submitBulkEnrichment(
  apiKey: string,
  jobName: string,
  contacts: FullEnrichContactInput[],
  options: SubmitBulkOptions = {},
): Promise<string> {
  if (contacts.length === 0) {
    throw new Error("FullEnrich: empty contacts list");
  }

  // Applique enrich_fields par defaut = work_emails SEULEMENT.
  // Les phones coutent ~10x plus cher que les emails chez FullEnrich et
  // par choix produit, pas de contact telephone → on vire.
  // "contact.emails" a ete renomme "contact.work_emails" le 2026-04-23.
  const normalized = contacts.map(c => ({
    ...c,
    enrich_fields: c.enrich_fields ?? ["contact.work_emails"],
  }));

  const body: Record<string, unknown> = { name: jobName, data: normalized };
  if (options.webhookUrl) body.webhook_url = options.webhookUrl;

  // Retry sur 5xx / 429 : FullEnrich renvoie des 504 quand leur LB sature
  // (observe en prod le 2026-04-23, 08:36). Ne retente pas sur 4xx metier.
  let lastStatus = 0;
  let lastBody: Record<string, unknown> = {};
  let nextWait = 1_000;
  const MAX_ATTEMPTS = 4;
  const MAX_WAIT = 6_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFullEnrich(`${FULLENRICH_BASE_URL}/contact/enrich/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    lastStatus = res.status;
    lastBody = await res.json().catch(() => ({}));

    if (res.ok) {
      const id = lastBody.enrichment_id;
      if (!id) {
        throw new FullEnrichError(
          "fullenrich.no_enrichment_id",
          "FullEnrich: no enrichment_id in response",
          500,
        );
      }
      return id as string;
    }

    const isTransient = res.status >= 500 || res.status === 429;
    if (!isTransient || attempt === MAX_ATTEMPTS) break;

    await new Promise(r => setTimeout(r, nextWait));
    nextWait = Math.min(nextWait * 2, MAX_WAIT);
  }

  throw new FullEnrichError(
    (lastBody.code as string) || "fullenrich.submit_failed",
    (lastBody.message as string) || `FullEnrich submit failed: HTTP ${lastStatus}`,
    lastStatus,
  );
}

/**
 * Poll le resultat d'un job FullEnrich jusqu'a FINISHED ou timeout.
 *
 * Strategie : polls toutes les `pollIntervalMs` avec un timeout global
 * `maxWaitMs`. Si `forceResultsAfterMs` est defini et qu'on l'atteint avant
 * le timeout final, on passe forceResults=true pour recuperer ce qui est
 * deja dispo (partial results). Utile pour garder le pipeline synchrone.
 *
 * Defaults adaptes a notre pipeline enrich-company qui bloque sur l'appel :
 *   - polls toutes les 6s
 *   - max 120s d'attente totale
 *   - apres 90s, force le retour des resultats partiels
 */
export interface PollBulkOptions {
  maxWaitMs?: number;
  /** @deprecated Plus utilise : on fait du exponential backoff. */
  pollIntervalMs?: number;
  forceResultsAfterMs?: number;
  /**
   * Callback optionnel pour recuperer le resultat via webhook plutot que
   * GET HTTP. Si fourni, on l'appelle d'abord a chaque tick. Retourne le
   * payload complet si recu, null sinon (on fallback sur GET HTTP).
   * Utilise typiquement pour lire pending_fullenrich_bulks en DB et eviter
   * le rate limit FullEnrich (60/min total, polling compte).
   */
  checkWebhook?: () => Promise<FullEnrichJobResult | null>;
}

export async function pollBulkEnrichment(
  apiKey: string,
  enrichmentId: string,
  options: PollBulkOptions = {},
): Promise<FullEnrichJobResult> {
  const maxWaitMs = options.maxWaitMs ?? 120_000;
  const forceResultsAfterMs = options.forceResultsAfterMs ?? 90_000;
  const checkWebhook = options.checkWebhook;

  const deadline = Date.now() + maxWaitMs;
  const forceAt = Date.now() + forceResultsAfterMs;

  // Si webhook actif : on check toutes les 2s sans hit FullEnrich. Tant que
  // pas recu, on continue a checker. Le HTTP GET ne sert que de filet de
  // securite (FullEnrich peut rater son webhook), donc on l'espace bcp.
  // Sans webhook : exponential backoff classique (1.5s -> cap 8s).
  let nextWait = checkWebhook ? 2_000 : 1_500;
  const MAX_WAIT = checkWebhook ? 4_000 : 8_000;
  const BACKOFF_FACTOR = checkWebhook ? 1.2 : 1.5;
  // Pour limiter les calls HTTP GET (qui mangent le rate limit), on ne fait
  // un GET que toutes les ~30s quand le webhook est actif.
  const HTTP_FALLBACK_INTERVAL_MS = checkWebhook ? 30_000 : 0;
  let lastHttpAt = 0;

  while (Date.now() < deadline) {
    // ─── 1. Check webhook DB (gratuit, 0 call FullEnrich) ───────────────────
    if (checkWebhook) {
      const cached = await checkWebhook();
      if (cached) {
        return cached;
      }
    }

    // ─── 2. Filet de securite : GET FullEnrich espace si webhook actif ──────
    const sinceLastHttp = Date.now() - lastHttpAt;
    const skipHttp = checkWebhook && sinceLastHttp < HTTP_FALLBACK_INTERVAL_MS;

    if (skipHttp) {
      await new Promise(resolve => setTimeout(resolve, nextWait));
      nextWait = Math.min(Math.ceil(nextWait * BACKOFF_FACTOR), MAX_WAIT);
      continue;
    }

    const forceResults = Date.now() >= forceAt;
    const url = forceResults
      ? `${FULLENRICH_BASE_URL}/contact/enrich/bulk/${enrichmentId}?forceResults=true`
      : `${FULLENRICH_BASE_URL}/contact/enrich/bulk/${enrichmentId}`;

    lastHttpAt = Date.now();
    const res = await fetchFullEnrich(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      // 5xx / 429 = transient (gateway/load balancer hiccup). On retry jusqu'au
      // timeout global au lieu d'abandonner tout le job au premier blip.
      const isTransient = res.status >= 500 || res.status === 429;
      if (isTransient && Date.now() + nextWait < deadline) {
        await new Promise(resolve => setTimeout(resolve, nextWait));
        nextWait = Math.min(Math.ceil(nextWait * BACKOFF_FACTOR), MAX_WAIT);
        continue;
      }
      throw new FullEnrichError(
        body.code || "fullenrich.poll_failed",
        body.message || `FullEnrich poll failed: HTTP ${res.status}`,
        res.status,
      );
    }

    const result = body as FullEnrichJobResult;
    if (result.status === "FINISHED" || result.status === "ERROR") {
      return result;
    }

    if (forceResults && Array.isArray(result.data) && result.data.length > 0) {
      return result;
    }

    await new Promise(resolve => setTimeout(resolve, nextWait));
    nextWait = Math.min(Math.ceil(nextWait * BACKOFF_FACTOR), MAX_WAIT);
  }

  throw new FullEnrichError(
    "fullenrich.timeout",
    `FullEnrich enrichment ${enrichmentId} did not finish within ${maxWaitMs}ms`,
    408,
  );
}

/**
 * Helper tout-en-un : submit + poll.
 *
 * Retourne la map `custom.contact_key` -> FullEnrichContactResult pour
 * rebrancher facilement le resultat sur le contact d'origine cote appelant.
 * Chaque contact doit avoir un `custom.contact_key` unique.
 */
export interface EnrichContactsOptions extends Omit<PollBulkOptions, "checkWebhook">, SubmitBulkOptions {
  /**
   * Factory pour construire le checkWebhook une fois qu'on connait l'id du
   * job FullEnrich. Permet au caller de passer un closure qui lit
   * pending_fullenrich_bulks via Supabase. Cf
   * _shared/fullenrich-webhook-helpers.ts buildCheckWebhook().
   */
  buildCheckWebhook?: (enrichmentId: string) => () => Promise<FullEnrichJobResult | null>;
  /**
   * Active la dedup d'emails pour economiser les credits. Cf
   * _shared/fullenrich-dedup.ts pour les details. Active 2 strategies :
   *   - cross-job : si pattern HIGH deja stocke pour le domaine -> skip FE
   *   - in-job : sample 3 contacts, detect pattern, deduit le reste si HIGH
   */
  dedupContext?: {
    // deno-lint-ignore no-explicit-any
    supabase: any;
    companyName: string;
  };
}

/** Bulk FE simple (no dedup). Internal helper. */
async function runFullEnrichBulk(
  apiKey: string,
  jobName: string,
  contacts: FullEnrichContactInput[],
  options: EnrichContactsOptions,
): Promise<{ id: string; resultsByKey: Map<string, FullEnrichContactResult>; creditsUsed: number }> {
  const id = await submitBulkEnrichment(apiKey, jobName, contacts, {
    webhookUrl: options.webhookUrl,
  });
  const checkWebhook = options.buildCheckWebhook?.(id);
  const job = await pollBulkEnrichment(apiKey, id, {
    maxWaitMs: options.maxWaitMs,
    forceResultsAfterMs: options.forceResultsAfterMs,
    checkWebhook,
  });
  const map = new Map<string, FullEnrichContactResult>();
  for (const item of job.data || []) {
    const key = item.custom?.contact_key;
    if (key) map.set(key, item);
  }
  return { id, resultsByKey: map, creditsUsed: job.cost?.credits ?? 0 };
}

export async function enrichContactsViaFullEnrich(
  apiKey: string,
  jobName: string,
  contacts: FullEnrichContactInput[],
  options: EnrichContactsOptions = {},
): Promise<{ id: string; resultsByKey: Map<string, FullEnrichContactResult>; creditsUsed: number }> {
  // S'assure qu'il y a bien un contact_key unique pour chaque contact
  const withKeys = contacts.map((c, idx) => {
    const key = c.custom?.contact_key || `c_${idx}`;
    return {
      ...c,
      custom: { ...(c.custom || {}), contact_key: key },
    };
  });

  // ─── 1. Cross-job dedup : pattern HIGH deja connu pour ce domaine ? ────────
  const dedup = options.dedupContext;
  if (dedup && withKeys.length >= 1) {
    try {
      const { resolveCompanyDomain, getDomainPattern, buildDeducedResult } =
        await import("./fullenrich-dedup.ts");

      const domain = await resolveCompanyDomain(dedup.supabase, dedup.companyName);
      if (domain) {
        const stored = await getDomainPattern(dedup.supabase, domain);
        if (stored && stored.tier === "high") {
          const map = new Map<string, FullEnrichContactResult>();
          for (const c of withKeys) {
            const r = buildDeducedResult(c, stored.pattern, domain, "high");
            const key = c.custom?.contact_key as string;
            map.set(key, r);
          }
          console.log(
            `[fullenrich-dedup] cross-job HIT for "${dedup.companyName}" (domain=${domain} pattern=${stored.pattern} conf=${stored.confidence.toFixed(2)}) -> deduit ${withKeys.length} contacts, 0 cred`,
          );
          return { id: `cross-dedup-${Date.now()}`, resultsByKey: map, creditsUsed: 0 };
        }
      }
    } catch (err) {
      console.warn(`[fullenrich-dedup] cross-job lookup failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── 2. In-job dedup : sample wave 1, detect pattern, deduce wave 2 ─────────
  // Active uniquement si on a >=4 contacts (sinon overhead inutile)
  if (dedup && withKeys.length >= 4) {
    try {
      const {
        extractSamplesFromResults,
        detectPatternFromWave1,
        buildDeducedResult,
        upsertDetectedPattern,
      } = await import("./fullenrich-dedup.ts");

      const sampleSize = 3;
      const wave1 = withKeys.slice(0, sampleSize);
      const wave2 = withKeys.slice(sampleSize);

      const wave1Result = await runFullEnrichBulk(apiKey, `${jobName}-w1`, wave1, options);

      const contactsByKey = new Map<string, FullEnrichContactInput>();
      for (const c of withKeys) {
        contactsByKey.set(c.custom!.contact_key as string, c);
      }
      const samples = extractSamplesFromResults(contactsByKey, wave1Result.resultsByKey);
      const detected = detectPatternFromWave1(samples);

      if (detected && detected.tier === "high") {
        // Pattern HIGH : deduire wave 2 sans appeler FE
        const map = new Map<string, FullEnrichContactResult>(wave1Result.resultsByKey);
        for (const c of wave2) {
          const r = buildDeducedResult(c, detected.pattern, detected.domain, "high");
          const key = c.custom?.contact_key as string;
          map.set(key, r);
        }
        // Stocke le pattern pour les runs futures
        await upsertDetectedPattern(
          dedup.supabase,
          detected.domain,
          detected.pattern,
          detected.tier,
          detected.confidence,
          samples.length,
        );
        console.log(
          `[fullenrich-dedup] in-job HIGH "${dedup.companyName}" (domain=${detected.domain} pattern=${detected.pattern} conf=${detected.confidence.toFixed(2)}) -> deduit ${wave2.length} contacts wave 2`,
        );
        return {
          id: wave1Result.id,
          resultsByKey: map,
          creditsUsed: wave1Result.creditsUsed,
        };
      }

      // Pattern absent ou medium : enrich wave 2 normalement
      const wave2Result = await runFullEnrichBulk(apiKey, `${jobName}-w2`, wave2, options);
      const merged = new Map<string, FullEnrichContactResult>([
        ...wave1Result.resultsByKey,
        ...wave2Result.resultsByKey,
      ]);
      console.log(
        `[fullenrich-dedup] in-job NO_PATTERN "${dedup.companyName}" (samples=${samples.length}) -> enrich complet ${withKeys.length} contacts`,
      );
      return {
        id: wave2Result.id,
        resultsByKey: merged,
        creditsUsed: wave1Result.creditsUsed + wave2Result.creditsUsed,
      };
    } catch (err) {
      console.warn(`[fullenrich-dedup] in-job dedup failed, fallback bulk complet: ${err instanceof Error ? err.message : err}`);
      // Fallback sur le bulk complet sans dedup
    }
  }

  // ─── 3. Default : bulk classique (no dedup) ────────────────────────────────
  return runFullEnrichBulk(apiKey, jobName, withKeys, options);
}

/**
 * Extrait l'email le plus probable d'un resultat FullEnrich.
 * Priorite : most_probable_work_email > work_emails[0] > personal_emails[0].
 * Filtre les emails non deliverables quand un statut est dispo.
 */
export function pickBestEmail(result: FullEnrichContactResult): string | null {
  return pickBestEmailWithSource(result).email;
}

/**
 * Source d'origine d'un email retourne par enrichContactsViaFullEnrich :
 *   - "deduced"    : email construit par pattern (cross-job ou in-job dedup).
 *                    Status DEDUCED_HIGH / DEDUCED_MEDIUM pose par buildDeducedResult.
 *   - "fullenrich" : email retourne par l'API FullEnrich (status DELIVERABLE,
 *                    CATCH_ALL, RISKY, UNKNOWN).
 * Sert au tagging post-envoi (apprentissage bounces). Cf
 * docs/plans/2026-05-11-email-deduction-robustness.md "bounce learning".
 */
export type EmailSource = "deduced" | "fullenrich";

export function pickBestEmailWithSource(
  result: FullEnrichContactResult,
): { email: string | null; source: EmailSource | null } {
  const ci = result.contact_info;
  if (!ci) return { email: null, source: null };

  const candidates: FullEnrichEmail[] = [
    ...(ci.most_probable_work_email ? [ci.most_probable_work_email] : []),
    ...(ci.work_emails || []),
    ...(ci.most_probable_personal_email ? [ci.most_probable_personal_email] : []),
    ...(ci.personal_emails || []),
  ];

  const deliverable = candidates.find(e => e.status === "DELIVERABLE" && e.email);
  if (deliverable) return { email: deliverable.email!, source: classifySource(deliverable.status) };

  const anyEmail = candidates.find(e => !!e.email);
  if (anyEmail) return { email: anyEmail.email!, source: classifySource(anyEmail.status) };

  return { email: null, source: null };
}

function classifySource(status: string | undefined): EmailSource {
  // DEDUCED_HIGH / DEDUCED_MEDIUM sont poses par buildDeducedResult
  // (cf fullenrich-dedup.ts). Tous les autres statuts viennent de FE.
  return status && status.startsWith("DEDUCED_") ? "deduced" : "fullenrich";
}

// pickBestPhone supprime (2026-04-24) : on ne requete jamais les phones
// chez FullEnrich (contact.phones coute ~10x plus cher que work_emails et
// par choix produit, pas de contact telephone). Si besoin un jour, reintroduire
// enrich_fields + helper ensemble.

// =============================================================================
// People search — /people/search : trouver les contacts d'une entreprise
// =============================================================================

/**
 * Profil retourne par le search (schema different du bulk enrichment).
 * Contient le LinkedIn URL, le job title, la societe, la location.
 * Ne contient PAS l'email/phone (il faut faire un bulk enrichment apres).
 */
export interface FullEnrichSearchPerson {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  location?: {
    country?: string;
    country_code?: string;
    city?: string;
    region?: string;
  };
  employment?: {
    current?: {
      title?: string;
      seniority?: string;
      is_current?: boolean;
      start_at?: string;
      company?: {
        name?: string;
        domain?: string;
        headcount?: number;
      };
    };
  };
  social_profiles?: {
    /** Depuis 2026-04-23 : "linkedin" renomme en "professional_network". */
    professional_network?: {
      url?: string;
      handle?: string;
      connection_count?: number;
    };
  };
  skills?: string[];
}

interface FullEnrichSearchResponse {
  people: FullEnrichSearchPerson[];
  metadata: {
    total: number;
    credits?: number;
    offset?: number;
    search_after?: string;
  };
}

export interface SearchFilter {
  value: string;
  exact_match?: boolean;
  exclude?: boolean;
}

export interface SearchContactsOptions {
  /** Noms des entreprises ou chercher. Au moins un parmi names/domains/ids requis. */
  companyNames?: SearchFilter[];
  /** Domaines d'entreprise (ex: "tereva.fr"). Plus precis que le nom. */
  companyDomains?: SearchFilter[];
  /**
   * IDs canoniques FullEnrich (UUID), obtenus via /company/search. Le plus
   * fiable : pas de probleme d'alias/orthographe. A privilegier si dispo.
   * Cf. _shared/fullenrich-company-resolve.ts.
   */
  companyIds?: SearchFilter[];
  /** Titres de poste a matcher (OR entre eux). */
  positionTitles?: SearchFilter[];
  /** Niveaux de seniorite ('Manager', 'Director', 'C-level', ...). */
  seniorityLevels?: SearchFilter[];
  /**
   * Localisations des personnes (pays / region / ville). Essentiel pour les
   * multinationales : sans ce filtre, FullEnrich retourne le pays siege
   * (ex : Berner Finlande alors qu'on vise Berner France).
   */
  personLocations?: SearchFilter[];
  /**
   * Plafond absolu de contacts a retourner pour cette recherche.
   * Garde-fou pour pas cramer les credits sur une grosse boite (grosse
   * multinationale type Bonduelle). Default 200 (~50 credits par search).
   */
  maxContacts?: number;
}

/**
 * Recherche des contacts dans une entreprise via /people/search.
 *
 * Pagination automatique : on enchaine les pages jusqu'a atteindre le total
 * ou le plafond maxContacts. Le cout est d'environ 0.25 credit par contact
 * retourne (mesure empirique, Avril 2026).
 */
export async function searchContactsAtCompany(
  apiKey: string,
  options: SearchContactsOptions,
): Promise<{ people: FullEnrichSearchPerson[]; totalAvailable: number; creditsUsed: number }> {
  const {
    companyNames,
    companyDomains,
    companyIds,
    positionTitles,
    seniorityLevels,
    personLocations,
    maxContacts = 200,
  } = options;

  if (
    (!companyNames || companyNames.length === 0) &&
    (!companyDomains || companyDomains.length === 0) &&
    (!companyIds || companyIds.length === 0)
  ) {
    throw new Error("FullEnrich search: need at least companyNames, companyDomains or companyIds");
  }

  const baseFilters: Record<string, unknown> = {};
  if (companyIds && companyIds.length > 0) baseFilters.current_company_ids = companyIds;
  if (companyNames && companyNames.length > 0) baseFilters.current_company_names = companyNames;
  if (companyDomains && companyDomains.length > 0) baseFilters.current_company_domains = companyDomains;
  if (positionTitles && positionTitles.length > 0) baseFilters.current_position_titles = positionTitles;
  if (seniorityLevels && seniorityLevels.length > 0) baseFilters.current_position_seniority_level = seniorityLevels;
  if (personLocations && personLocations.length > 0) baseFilters.person_locations = personLocations;

  const PAGE_SIZE = 100; // max autorise par FullEnrich
  const allPeople: FullEnrichSearchPerson[] = [];
  let totalAvailable = 0;
  let totalCredits = 0;
  let searchAfter: string | null = null;

  while (allPeople.length < maxContacts) {
    const body: Record<string, unknown> = {
      ...baseFilters,
      limit: Math.min(PAGE_SIZE, maxContacts - allPeople.length),
    };
    if (searchAfter) body.search_after = searchAfter;

    const res = await fetchFullEnrich(`${FULLENRICH_BASE_URL}/people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new FullEnrichError(
        payload.code || "fullenrich.search_failed",
        payload.message || `FullEnrich search failed: HTTP ${res.status}`,
        res.status,
      );
    }

    const typedPayload = payload as FullEnrichSearchResponse;
    const people = typedPayload.people || [];
    allPeople.push(...people);
    totalAvailable = typedPayload.metadata?.total ?? allPeople.length;
    totalCredits += typedPayload.metadata?.credits ?? 0;

    // Stop si page vide ou plus rien a paginer
    if (people.length === 0 || !typedPayload.metadata?.search_after) break;
    if (allPeople.length >= totalAvailable) break;
    searchAfter = typedPayload.metadata.search_after;
  }

  return {
    people: allPeople.slice(0, maxContacts),
    totalAvailable,
    creditsUsed: totalCredits,
  };
}

/**
 * Recherche en cascade : essaie chaque niveau geographique du plus precis au
 * plus large, et stoppe des qu'on a au moins `minContacts` contacts.
 *
 * Pourquoi : sur les multinationales, une recherche "France" ramene 30 DRH
 * dispatches partout, dont 1 seul pertinent pour la filiale ciblee. La
 * cascade va d'abord chercher a la ville (Nanterre), puis au departement
 * (Hauts-de-Seine), puis a la region (Ile-de-France), puis au pays.
 *
 * Verifie empiriquement (04/2026) :
 *   - Les calls vides (0 contact) coutent 0 credit -> cascade gratuite
 *     quand on "manque" un niveau.
 *   - person_locations est un OR (pas un ranking par proximite),
 *     d'ou la necessite de plusieurs calls successifs.
 *
 * @param geoCascade Liste des niveaux a essayer dans l'ordre (typiquement
 *   genere par buildGeoCascade() depuis _shared/geo-cascade.ts).
 * @param minContacts Seuil d'arret (default 1). Si on trouve >= minContacts
 *   a un niveau, on stoppe et on retourne ce qu'on a.
 */
export async function searchContactsAtCompanyCascade(
  apiKey: string,
  options: Omit<SearchContactsOptions, "personLocations">,
  geoCascade: SearchFilter[],
  minContacts = 1,
): Promise<{
  people: FullEnrichSearchPerson[];
  totalAvailable: number;
  creditsUsed: number;
  /** Index dans geoCascade ou la recherche s'est arretee. -1 si rien trouve. */
  stoppedAtLevel: number;
  /** Valeur du level d'arret (pour log/debug). Null si rien trouve. */
  stoppedAtValue: string | null;
}> {
  if (geoCascade.length === 0) {
    throw new Error("searchContactsAtCompanyCascade: geoCascade cannot be empty");
  }

  let totalCredits = 0;

  for (let i = 0; i < geoCascade.length; i++) {
    const level = geoCascade[i];
    const result = await searchContactsAtCompany(apiKey, {
      ...options,
      personLocations: [level],
    });
    totalCredits += result.creditsUsed;

    if (result.people.length >= minContacts) {
      return {
        ...result,
        creditsUsed: totalCredits,
        stoppedAtLevel: i,
        stoppedAtValue: level.value,
      };
    }
  }

  // Rien trouve meme au niveau le plus large : on retourne le dernier
  // resultat (probablement vide) avec le total des credits accumules.
  return {
    people: [],
    totalAvailable: 0,
    creditsUsed: totalCredits,
    stoppedAtLevel: -1,
    stoppedAtValue: null,
  };
}

// =============================================================================
// Heuristiques anti-cabinets de recrutement
// =============================================================================

const RECRUITMENT_TITLE_PATTERNS = /\b(charge[e]? (de )?recrutement|consultant[e]? (en )?recrutement|recruteur|recruiter|talent acquisition|headhunt|chasseur de t[eê]tes|dirigeant[e]? cabinet|cabinet de recrutement|associe[e]? g[ée]rant[e]?|business manager|consultant[e]? rh|sourcing specialist|delivery specialist cabinet)\b/i;

/**
 * Retourne true si le job title ressemble a celui d'un recruteur ou d'un
 * membre de cabinet de recrutement (vs un commercial/dir co/RH chez un
 * vrai employeur).
 */
export function isRecruitmentTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return RECRUITMENT_TITLE_PATTERNS.test(title);
}

/**
 * Analyse un ensemble de profils retournes par le search et decide si
 * l'entreprise est en realite un cabinet de recrutement.
 *
 * Heuristique : si plus de 60% des profils ont un titre de recrutement,
 * ou si TOUS les profils sont des recruteurs (peu de profils, tous orientes
 * recrutement), c'est un cabinet et on doit dismiss.
 */
export function looksLikeRecruitmentAgencyFromSearch(
  people: FullEnrichSearchPerson[],
): { isAgency: boolean; reason: string; recruiterCount: number; totalCount: number } {
  if (people.length === 0) {
    return { isAgency: false, reason: "empty", recruiterCount: 0, totalCount: 0 };
  }

  const recruiterCount = people.filter(p =>
    isRecruitmentTitle(p.employment?.current?.title)
  ).length;
  const ratio = recruiterCount / people.length;

  // Signal fort : >= 60% des profils sont des recruteurs
  if (ratio >= 0.6) {
    return {
      isAgency: true,
      reason: `${Math.round(ratio * 100)}% des profils ont un titre de recrutement (${recruiterCount}/${people.length})`,
      recruiterCount,
      totalCount: people.length,
    };
  }

  // Signal faible mais sur petite boite : tous les profils sont des recruteurs
  if (people.length <= 5 && recruiterCount === people.length) {
    return {
      isAgency: true,
      reason: `petite boite (${people.length} profils) exclusivement recruteurs`,
      recruiterCount,
      totalCount: people.length,
    };
  }

  return { isAgency: false, reason: "", recruiterCount, totalCount: people.length };
}

/**
 * Retire les profils qui sont des recruteurs (pour ne pas contacter un
 * cabinet comme s'il etait un prospect).
 */
export function filterOutRecruiters(people: FullEnrichSearchPerson[]): FullEnrichSearchPerson[] {
  return people.filter(p => !isRecruitmentTitle(p.employment?.current?.title));
}

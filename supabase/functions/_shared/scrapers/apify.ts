/**
 * Apify LinkedIn Jobs Scraper
 * Scrape des offres d'emploi LinkedIn comme déclencheurs d'achat (comme Adzuna /
 * France Travail), via un actor Apify. Actor par défaut : valig/linkedin-jobs-scraper
 * — cookie-free, pay-per-event, tourne avec le seul token (pas d'approbation console).
 * Le mapping accepte aussi des noms de champs alternatifs (company/jobUrl/postedAt)
 * pour rester compatible si on bascule sur un autre actor via APIFY_JOBS_ACTOR_ID.
 */

import type { Scraper, ScraperResult, ScrapedSignal } from './types.ts';
import { sanitizeScrapedContent } from './types.ts';

const APIFY_API = 'https://api.apify.com/v2';
// Actor par défaut : valig/linkedin-jobs-scraper. Override possible via env.
const DEFAULT_ACTOR_ID = Deno.env.get('APIFY_JOBS_ACTOR_ID') || 'valig~linkedin-jobs-scraper';
// Plafond de résultats par mot-clé pour maîtriser le coût du run.
const MAX_ITEMS = Number(Deno.env.get('APIFY_JOBS_MAX_ITEMS') || '25');
const TIMEOUT_MS = 120_000;
// Plafond de caractères pour la description stockée. Une offre LinkedIn remonte
// ~4 000 caractères, dupliqués dans extracted_data.description ET raw_content :
// sur du volume ça gonfle la table et les embeddings pour rien. On tronque.
const MAX_DESC = 2000;
// Budget wall-clock global du run. Chaque mot-clé lance un run d'actor séquentiel
// (jusqu'à TIMEOUT_MS) + 500 ms de délai ; avec plusieurs keywords on peut
// approcher la limite de l'edge function et se faire tuer en plein insert
// (signaux partiels, aucune erreur loguée). On préfère un budget global — qui
// s'adapte à la latence réelle des runs — plutôt qu'un plafond fixe de keywords.
// Surchargeable via APIFY_JOBS_BUDGET_MS (lu à l'invocation).
const DEFAULT_BUDGET_MS = 90_000;

interface ApifyJobPosting {
  id?: string | number;
  title?: string;
  company?: string;
  companyName?: string;
  companyUrl?: string;
  location?: string;
  description?: string;
  jobUrl?: string;
  url?: string;
  applyUrl?: string;
  postedAt?: string;
  publishedAt?: string;
  postedDate?: string;
  contractType?: string;
  experienceLevel?: string;
  salary?: string;
  recruiterName?: string;
}

function mapApifyJobToSignal(job: ApifyJobPosting): ScrapedSignal | null {
  const companyName = (job.company || job.companyName || '').trim();
  if (!companyName || companyName.length < 2) return null;

  const title = job.title || '';
  const location = job.location || null;
  const url = job.url || job.jobUrl || job.applyUrl || '';
  // Tronqué au plafond : raw_content est construit à partir de cette description
  // déjà bornée, donc les deux champs stockés restent maîtrisés.
  const description = job.description
    ? sanitizeScrapedContent(job.description).slice(0, MAX_DESC)
    : null;

  const rawContent = sanitizeScrapedContent(
    [title, companyName, location, description].filter(Boolean).join(' ')
  );

  return {
    signal_type: 'job_posting',
    source: 'apify_linkedin',
    source_url: url,
    raw_content: rawContent,
    extracted_data: {
      job_title: title || null,
      company_name: companyName,
      company_url: job.companyUrl || null,
      location,
      description,
      posted_date: job.postedDate || job.postedAt || job.publishedAt || null,
      contract_type: job.contractType || null,
      experience_level: job.experienceLevel || null,
      salary: job.salary || null,
      recruiter_name: job.recruiterName || null,
    },
  };
}

export const apifyScraper: Scraper = {
  name: 'apify_linkedin',

  async fetch(keywords: string[], opts: { location?: string; credentials: Record<string, string> }): Promise<ScraperResult> {
    const start = Date.now();
    const signals: ScrapedSignal[] = [];
    const errors: string[] = [];
    const seenIds = new Set<string>();

    const apiToken = opts.credentials.api_token || opts.credentials.api_key;
    if (!apiToken) {
      return { signals: [], errors: ['APIFY_API_TOKEN not configured'], duration_ms: 0 };
    }

    const actorId = opts.credentials.actor_id || DEFAULT_ACTOR_ID;
    const endpoint = `${APIFY_API}/acts/${actorId}/run-sync-get-dataset-items`;
    const params = new URLSearchParams({ token: apiToken, timeout: '120', format: 'json' });
    const budgetMs = Number(Deno.env.get('APIFY_JOBS_BUDGET_MS') || DEFAULT_BUDGET_MS);

    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];

      // Garde-fou wall-clock : si le budget est dépassé, on arrête proprement
      // et on loggue les mots-clés non traités plutôt que de risquer un kill
      // en plein insert.
      if (Date.now() - start > budgetMs) {
        const skipped = keywords.slice(i);
        const msg = `budget de ${budgetMs}ms dépassé, ${skipped.length} mot(s)-clé(s) non traité(s): ${skipped.join(', ')}`;
        console.warn(`[apify_linkedin] ${msg}`);
        errors.push(`apify_linkedin: ${msg}`);
        break;
      }

      try {
        // Schéma d'entrée de valig/linkedin-jobs-scraper : title (string) +
        // location (string) + limit (int). `rows`/`maxItems` selon les actors ;
        // on envoie les deux clés courantes pour rester tolérant.
        const body: Record<string, unknown> = { title: keyword, limit: MAX_ITEMS, rows: MAX_ITEMS };
        if (opts.location) body.location = opts.location;

        const response = await fetch(`${endpoint}?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          const text = await response.text();
          errors.push(`apify_linkedin "${keyword}": HTTP ${response.status} - ${text.substring(0, 100)}`);
          continue;
        }

        const items: ApifyJobPosting[] = await response.json();
        if (!Array.isArray(items)) continue;

        console.log(`[apify_linkedin] "${keyword}": ${items.length} results`);

        for (const item of items) {
          const id = String(item.id || item.url || item.jobUrl || '');
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);

          const signal = mapApifyJobToSignal(item);
          if (signal) signals.push(signal);
        }

        // Délai respectueux entre les requêtes
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`apify_linkedin "${keyword}": ${msg}`);
      }
    }

    return { signals, errors, duration_ms: Date.now() - start };
  },
};

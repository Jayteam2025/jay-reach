/**
 * Apify LinkedIn Jobs Scraper
 * Utilise un actor Apify pour scraper des offres d'emploi LinkedIn comme déclencheurs d'achat.
 * Inspiré du client Apify de jay/supabase/functions/_shared/apify-linkedin-profile.ts
 */

import type { Scraper, ScraperResult, ScrapedSignal } from './types.ts';
import { sanitizeScrapedContent } from './types.ts';

const APIFY_API = 'https://api.apify.com/v2';
// Actor par défaut : LinkedIn Jobs Search (harvestapi, $1 per 1k results)
const DEFAULT_ACTOR_ID = Deno.env.get('APIFY_JOBS_ACTOR_ID') || 'harvestapi~linkedin-jobs-search';
const TIMEOUT_MS = 120_000;

interface ApifyJobPosting {
  id?: string;
  title?: string;
  company?: string;
  companyName?: string;
  location?: string;
  description?: string;
  jobUrl?: string;
  url?: string;
  postedAt?: string;
  publishedAt?: string;
}

function mapApifyJobToSignal(job: ApifyJobPosting): ScrapedSignal | null {
  const companyName = (job.company || job.companyName || '').trim();
  if (!companyName || companyName.length < 2) return null;

  const title = job.title || '';
  const location = job.location || null;
  const url = job.jobUrl || job.url || '';
  const description = job.description ? sanitizeScrapedContent(job.description) : null;

  const rawContent = sanitizeScrapedContent(
    [title, companyName, location, description].filter(Boolean).join(' ')
  );

  return {
    signal_type: 'linkedin_activity',
    source: 'apify_linkedin',
    source_url: url,
    raw_content: rawContent,
    extracted_data: {
      job_title: title || null,
      company_name: companyName,
      location,
      description,
      posted_date: job.postedAt || job.publishedAt || null,
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

    for (const keyword of keywords) {
      try {
        const body: Record<string, unknown> = { queries: [keyword] };
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
          const id = item.id || item.jobUrl || item.url || '';
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

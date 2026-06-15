/**
 * Adzuna Job Search API Scraper
 * Structured data with company name always present.
 * Covers France only (BE/CH not supported by Adzuna).
 */

import type { Scraper, ScraperResult, ScrapedSignal } from './types.ts';
import { sanitizeScrapedContent } from './types.ts';

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company: { display_name: string };
  location: { display_name: string; area: string[] };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  contract_type?: string;
  category?: { label: string; tag: string };
  latitude?: number;
  longitude?: number;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
  mean?: number;
}

async function searchAdzuna(
  appId: string,
  appKey: string,
  country: string,
  keywords: string,
  page = 1,
): Promise<{ jobs: AdzunaJob[]; total: number; error?: string }> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: keywords,
    results_per_page: '50',
    max_days_old: '30',
    sort_by: 'date',
  });

  try {
    const url = `${ADZUNA_BASE}/${country}/search/${page}?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return { jobs: [], total: 0, error: `Adzuna ${response.status}: ${text.substring(0, 100)}` };
    }

    const data: AdzunaResponse = await response.json();
    return { jobs: data.results || [], total: data.count || 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { jobs: [], total: 0, error: `Adzuna error: ${msg}` };
  }
}

function mapAdzunaJobToSignal(job: AdzunaJob): ScrapedSignal | null {
  const companyName = job.company?.display_name?.trim();
  if (!companyName || companyName.length < 2) return null;

  const location = job.location?.display_name || job.location?.area?.join(', ') || null;

  const salary = (job.salary_min && job.salary_is_predicted !== '1')
    ? (job.salary_max && job.salary_max !== job.salary_min
      ? `${job.salary_min}€ - ${job.salary_max}€`
      : `${job.salary_min}€`)
    : null;

  const rawContent = sanitizeScrapedContent(
    [job.title, companyName, location, job.description].filter(Boolean).join(' ')
  );

  return {
    signal_type: 'job_posting',
    source: 'adzuna',
    source_url: job.redirect_url,
    raw_content: rawContent,
    extracted_data: {
      job_title: job.title,
      company_name: companyName,
      location,
      description: job.description ? sanitizeScrapedContent(job.description) : null,
      posted_date: job.created || null,
      salary,
      contract_type: job.contract_type || null,
    },
  };
}

export const adzunaScraper: Scraper = {
  name: 'adzuna',

  async fetch(keywords: string[], opts: { location?: string; credentials: Record<string, string> }): Promise<ScraperResult> {
    const start = Date.now();
    const signals: ScrapedSignal[] = [];
    const errors: string[] = [];
    const seenIds = new Set<string>();

    const appId = opts.credentials.app_id;
    const appKey = opts.credentials.app_key;
    if (!appId || !appKey) {
      return { signals: [], errors: ['ADZUNA_APP_ID or ADZUNA_APP_KEY not configured'], duration_ms: 0 };
    }

    // Keywords de recherche = config du workspace (trigger.search_keywords),
    // plus de liste hardcodée (dé-hardcoding PR5). France only (Adzuna ne
    // supporte pas BE/CH). scrape-job-signals skippe déjà si keywords vide.
    for (const kw of keywords) {
      const { jobs, total, error } = await searchAdzuna(appId, appKey, 'fr', kw);
      if (error) {
        errors.push(`adzuna_fr "${kw}": ${error}`);
        continue;
      }

      console.log(`[adzuna] "${kw}": ${jobs.length} results (${total} total)`);

      for (const job of jobs) {
        // Dedup by job ID
        if (seenIds.has(job.id)) continue;
        seenIds.add(job.id);

        const signal = mapAdzunaJobToSignal(job);
        if (signal) signals.push(signal);
      }

      // Respectful delay between requests
      await new Promise(r => setTimeout(r, 250));
    }

    return { signals, errors, duration_ms: Date.now() - start };
  },
};

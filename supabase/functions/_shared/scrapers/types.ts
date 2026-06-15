export interface ScrapedSignal {
  signal_type: 'job_posting' | 'linkedin_activity' | 'direct_listing' | 'google_alert';
  source: string;
  source_url: string;
  raw_content: string;
  extracted_data: {
    company_name?: string | null;
    job_title?: string | null;
    location?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    description?: string | null;
    posted_date?: string | null;
    [key: string]: unknown;
  };
}

export interface ScraperResult {
  signals: ScrapedSignal[];
  errors: string[];
  duration_ms: number;
}

export interface Scraper {
  name: string;
  fetch(keywords: string[], opts: { location?: string; credentials: Record<string, string> }): Promise<ScraperResult>;
}

export interface IcpCriteria {
  sectors?: string[];
  company_sizes?: string[];
  regions?: string[];
  job_keywords: string[];
  exclude_keywords?: string[];
  min_score?: number;
}

export function sanitizeScrapedContent(content: string): string {
  // Strip HTML tags
  let clean = content.replace(/<[^>]*>/g, '');
  // Remove control characters
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Trim excessive whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}

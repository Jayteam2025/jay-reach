import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { apifyScraper } from './apify.ts';

// ─── Helpers ────────────────────────────────────────────────────────────────
// Remplace globalThis.fetch par un stub qui renvoie `payload` en JSON. Rend
// aussi les requetes capturees pour verifier l'appel a l'API Apify.
function stubFetch(
  payload: unknown,
  opts: { status?: number; body?: string } = {},
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const ok = (opts.status ?? 200) < 400;
    return Promise.resolve(
      new Response(
        opts.body ?? JSON.stringify(payload),
        { status: opts.status ?? 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response & { ok: boolean },
    ).then((r) => {
      // Response.ok derive du status, deja correct — assert de coherence.
      assertEquals(r.ok, ok);
      return r;
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const CREDS = { credentials: { api_token: 'test-token' } };

// ─── Tests ────────────────────────────────────────────────────────────────

Deno.test('mappe une offre Apify en ScrapedSignal', async () => {
  const { calls, restore } = stubFetch([
    {
      id: 'job-1',
      title: 'Administrateur Salesforce',
      company: 'ACME Corp',
      location: 'Paris',
      description: 'Nous recherchons un admin <b>Salesforce</b>.',
      jobUrl: 'https://linkedin.com/jobs/view/1',
      postedAt: '2026-07-01',
    },
  ]);
  try {
    const res = await apifyScraper.fetch(['salesforce admin'], CREDS);
    assertEquals(res.errors, []);
    assertEquals(res.signals.length, 1);
    const s = res.signals[0];
    assertEquals(s.signal_type, 'job_posting');
    assertEquals(s.source, 'apify_linkedin');
    assertEquals(s.source_url, 'https://linkedin.com/jobs/view/1');
    assertEquals(s.extracted_data.company_name, 'ACME Corp');
    assertEquals(s.extracted_data.job_title, 'Administrateur Salesforce');
    assertEquals(s.extracted_data.location, 'Paris');
    // HTML strippe par sanitizeScrapedContent
    assertEquals(s.extracted_data.description, 'Nous recherchons un admin Salesforce.');
    // Appel a l'API Apify avec le token
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url.includes('api.apify.com/v2/acts/'), true);
    assertEquals(calls[0].url.includes('token=test-token'), true);
  } finally {
    restore();
  }
});

Deno.test('deduplique les offres par id', async () => {
  const { restore } = stubFetch([
    { id: 'dup', title: 'A', company: 'Acme', jobUrl: 'u1' },
    { id: 'dup', title: 'A', company: 'Acme', jobUrl: 'u1' },
    { id: 'other', title: 'B', company: 'Beta', jobUrl: 'u2' },
  ]);
  try {
    const res = await apifyScraper.fetch(['k'], CREDS);
    assertEquals(res.signals.length, 2);
  } finally {
    restore();
  }
});

Deno.test('ignore les offres sans nom de societe', async () => {
  const { restore } = stubFetch([
    { id: '1', title: 'Sans boite', company: '', jobUrl: 'u1' },
    { id: '2', title: 'OK', companyName: 'Beta', jobUrl: 'u2' },
  ]);
  try {
    const res = await apifyScraper.fetch(['k'], CREDS);
    assertEquals(res.signals.length, 1);
    assertEquals(res.signals[0].extracted_data.company_name, 'Beta');
  } finally {
    restore();
  }
});

Deno.test('renvoie une erreur si token absent (aucun fetch)', async () => {
  const { calls, restore } = stubFetch([]);
  try {
    const res = await apifyScraper.fetch(['k'], { credentials: {} });
    assertEquals(res.signals, []);
    assertEquals(res.errors, ['APIFY_API_TOKEN not configured']);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

Deno.test('capture les erreurs HTTP sans crasher', async () => {
  const { restore } = stubFetch(null, { status: 429, body: 'rate limited' });
  try {
    const res = await apifyScraper.fetch(['k'], CREDS);
    assertEquals(res.signals.length, 0);
    assertEquals(res.errors.length, 1);
    assertEquals(res.errors[0].includes('HTTP 429'), true);
  } finally {
    restore();
  }
});

Deno.test('accepte api_key en fallback du champ api_token', async () => {
  const { calls, restore } = stubFetch([{ id: '1', title: 'T', company: 'Corp', jobUrl: 'u' }]);
  try {
    const res = await apifyScraper.fetch(['k'], { credentials: { api_key: 'legacy-key' } });
    assertEquals(res.signals.length, 1);
    assertEquals(res.signals[0].extracted_data.company_name, 'Corp');
    assertEquals(calls[0].url.includes('token=legacy-key'), true);
  } finally {
    restore();
  }
});

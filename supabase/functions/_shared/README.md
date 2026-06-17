# Jay Reach — _shared Modules

## Overview

This directory contains the **vendoré** (vendored) _shared modules extracted from Jay's prospection edge functions. These modules are generic utilities and business logic for prospecting, enrichment, and outreach — with **NO coupling to Jay's meeting assistant**.

**Extraction Date:** 2026-06-15 (Task 8)  
**Source Closure:** 60 files + 1 additional (anthropic-client.ts) from 38 prospection functions

---

## Module Categories

### Generic Utilities (No Business Logic)
- **validation.ts** — Input validation (URLs, emails, names)
- **cors.ts** — CORS header helpers for edge functions
- **app-url.ts** — App URL resolution (getAppUrl)
- **audit-events.ts** — Audit logging (pattern_audit_events)
- **rate-limiter.ts** — Rate limiting via Postgres
- **token-encryption.ts** — AES-GCM encryption for secrets in workspace_providers

### Prospection Core (Business Logic)
- **workspace.ts, workspace-config.ts, workspace-config-core.ts** — Workspace + config management (profiles, plans, branding)
- **workspace-brand.ts** — Branding overrides per workspace
- **subscription-access.ts** — Subscription tier gating (plans: free/growth/business)
- **internal-users.ts** — Hard-coded internal user list (detection, filtering)
- **ai-role-validator.ts** — AI role classification (IA/DevOps/Data/etc.)

### Email & Outreach
- **email-gate.ts** — Email deliverability gate (Bouncer verifications → Smartlead push decision)
- **email-pattern.ts** — Email pattern deduction
- **smartlead.ts** — Smartlead API client
- **resend.ts** — Resend email relay (transactional, not prospection)
- **outreach/** — Outreach provider registry (currently Smartlead only)
  - `registry.ts` — Resolve outreach provider per workspace
  - `types.ts` — OutreachProvider interface
  - `smartlead-provider.ts` — Smartlead implementation

### Enrichment Providers
- **providers/** — LLM + data enrichment provider registry
  - `registry.ts` — Resolve provider by workspace + type (LLM, enricher, validator)
  - `catalog.ts` — Provider descriptors (name, tier, cost)
  - `types.ts` — LLMProvider, EnricherProvider, ValidatorProvider interfaces
  - `anthropic.ts` — Claude (Haiku/Sonnet) LLM adapter
  - `openai-compatible.ts` — Generic OpenAI-compatible adapter (Mistral, etc.)
  - `bouncer.ts` — Bouncer email validator
  - `fullenrich.ts` — FullEnrich company/contact enricher
  - `reoon.ts` — Reoon email validator
  - `demo.ts` — Demo provider (for testing)
- **anthropic-client.ts** — Raw Anthropic client (Message Batches API, no retry)

### Job/Company Enrichment
- **fullenrich.ts, fullenrich-company-resolve.ts, fullenrich-webhook-helpers.ts** — FullEnrich API client + company deduplication
- **fullenrich-company-resolve.ts** — Match prospects to companies (dedup logic)
- **person-enrichment-core.ts** — Person enrichment logic (email deduction, company resolution)
- **crm-detection/** — Detect company's CRM from web signals
  - `types.ts` — CRM detection types
  - `confidence.ts` — Confidence scoring
  - `dns-resolver.ts` — DNS lookups (CNAME, MX)
  - `domain-resolver.ts` — Domain consolidation (ppg.com = Pipedrive)
  - `homepage-scraper.ts` — Fetch + parse company homepage
  - `jobs-analyzer.ts` — Job posting scraper (Adzuna, France Travail)
  - `linkedin-skills-analyzer.ts` — Extract skills from LinkedIn profile
  - `web-search-crm.ts` — Web search for CRM artifacts
  - `signatures.ts` — CRM footprints in email/web

### Job Scrapers
- **scrapers/** — Job posting aggregators
  - `adzuna.ts` — Adzuna job API
  - `france-travail.ts` — France Travail (ex-Pôle Emploi) API
  - `honeypot-detector.ts` — Detect fake job postings
  - `signal-processor.ts` — Job posting → prospect signal
  - `types.ts` — Scraper types
  - `company-name-validator.ts` — Validate company names from job postings

### Prospect Signals & Scoring
- **signal-scoring-core.ts** — Score prospect signals (job posting, company growth, CRM adoption)
- **linkedin-validator.ts** — Validate LinkedIn URLs + extract identifier
- **name-reconstruction.ts** — Reconstruct full names from email/LinkedIn

### Geographic & Industry
- **geo-cascade.ts** — Geographic cascade (city → region → country)
- **insee-sirene.ts** — INSEE SIRENE API (French company registry)

### Schemas
- **schemas/** — Zod validation schemas
  - `common.ts` — Shared types (ContactInput, CompanyInput, etc.)
  - `email.ts` — Email-specific schemas (deduction result, provider validation)

---

## Coupling: Assistant Modules Removed

The following modules from Jay's meeting assistant were **NOT copied** because prospection does not depend on them:

- `meeting-prep-types`, `meeting-context`, `meeting-context-enrich`
- `meeting-detectors`, `email-inbox-reader`, `email-recap-message`
- `email-system-filter`, `email-sender-filter`, `email-signature`
- `email-contact-search`, `email-duplicate-detection`
- `email-crm-context`, `email-crm-context-render`, `email-crm-beta`
- `email-whatsapp-message`, `crm-enrichers`, `crm-contact-lookup`
- `crm-error-collector`, `crm-logger`, `crm-note-formatter`
- `pipedrive-persons`, `action-normalizer`, `company-change-note`
- `stage-resolver`, `stt-corrections`, `whatsapp-templates`
- `onboarding-messages`, `onboarding-trigger`, `assistant-reply`
- `watchlist-notifier`, `credits`, `google-token`, `microsoft-token`
- `hubspot-token`, `odoo-client`, `zoho-*` (all Zoho modules)

### Module Resolution Status
✅ `deno check supabase/functions/_shared/**/*.ts` — **GREEN**  
✅ No forbidden/assistant imports  
✅ All 61 _shared files resolved correctly

---

## Adding a New Provider

To add a new enrichment or LLM provider:

1. **Create provider file** (e.g., `providers/myvendor.ts`)
2. **Implement interface** from `providers/types.ts` (LLMProvider, EnricherProvider, or ValidatorProvider)
3. **Register in catalog** (`providers/catalog.ts`) — add descriptor with name, tier, cost
4. **Update registry** (`providers/registry.ts`) — add case in `resolveProvider()` function
5. **Add secret handling** in workspace_providers table (encrypted via `token-encryption.ts`)
6. **Test** with `deno test` (if needed)

Example:
```typescript
// providers/myprovider.ts
import type { EnricherProvider } from './types.ts';

export const myEnricher: EnricherProvider = {
  name: 'myvendor',
  enrich: async (contact, company) => { /* ... */ },
};
```

---

## Testing

All `.test.ts` files are co-located with their sources. Run via:
```bash
deno test supabase/functions/_shared/**/*.test.ts
```

---

## Notes

- **No database access** in _shared (all DB calls go through edge functions)
- **No Supabase client initialization** — passed as parameter to functions needing DB access
- **Deno-only** — these modules run in Supabase Edge Functions (Deno runtime)
- **Type errors:** Pre-existing TS2741/TS2345/TS2322 type mismatches from source (not blocking module resolution)

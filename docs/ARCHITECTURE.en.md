> [Français](ARCHITECTURE.md) | **English**

# Architecture of Jay Reach

## Overview

Jay Reach is a multi-tenant prospecting platform built around three pillars:

1. **Sourcer** — Scrapes job postings (Adzuna, France Travail)
2. **Scoring Engine** — Rates prospects based on commercial signals (LLM + rules)
3. **Outreach** — Enriches profiles, verifies emails, sends cold email campaigns

All logic is **user-agnostic**: each operator configures their own triggers, personas, templates, and providers (LLM, enrichment, outreach) via the web interface.

---

## Prospecting Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SOURCING                                                     │
│    Adzuna, France Travail → prospect_signals (job_posting)      │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. SCORING & CLASSIFICATION                                    │
│    LLM evaluates signals → prospect_signals.score               │
│    Automatic archiving (top-15 vs archived)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ENRICHMENT                                                   │
│    FullEnrich → contact.linkedin_url, deduced emails            │
│    Brave Search + Apify → LinkedIn profile                      │
│    insee-sirene → legal company data                            │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. EMAIL PATTERN AUDIT                                          │
│    Pattern deduction: [first.last@company.fr](mailto:first.last@company.fr)           │
│    Double-check: FullEnrich vs patterns                         │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. DELIVERABILITY VERIFICATION                                  │
│    Bouncer / Reoon: valid / invalid / risky / disposable        │
│    Caching in email_verification_cache                          │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. DELIVERABILITY GATE                                          │
│    Rules: bouncer=valid → push                                  │
│           bouncer=risky + high pattern → push (optional)        │
│           empirical bounce_rate > 0.15 → skip                   │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. OUTREACH / SMARTLEAD                                         │
│    Push prospect + email → Smartlead campaign                   │
│    Webhook: status updates (sent, bounced, replied, opened)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Front-End Architecture

### Routing

The app is a **React SPA** with a single main route:

- **`/`** → `Prospection.tsx` page
  - Tabs managed by query param `?tab=triggers|personas|messages|campaigns|settings`
  - `AuthGate` global wrapper (login redirect if unauthenticated)

### Key Components

```
src/
├── App.tsx                  — Router + providers (React Query, Theme, i18n)
├── pages/
│   └── Prospection.tsx      — Main layout, tabs
├── components/
│   ├── auth/                — AuthGate, login/register forms
│   ├── prospection/         — Triggers, Personas, Messages, Campaigns
│   └── ui/                  — Radix UI + shadcn/ui (button, input, form, etc.)
├── hooks/
│   └── useProspectionData() — TanStack Query, edge function mutations
├── lib/
│   └── supabase.ts          — Supabase client (SupabaseClient + real-time)
└── locales/                 — i18n FR/EN/NL
```

### Global State

- **TanStack Query**: request caching, edge function mutations
- **Supabase Auth**: user session, JWT token
- **Next Themes**: dark/light mode
- **React i18next**: translations

---

## Back-End Architecture

### Authentication

1. **`auth.users`** (managed by Supabase Auth) — email + password
2. **`profiles`** — extends auth.users (first name, last name, current plan)
3. **`workspaces`** — organization (multi-tenant)
4. **`workspace_members`** — workspace membership + role (owner/admin/member/viewer)

**RLS helper function:** `user_workspaces(min_role)` SECURITY DEFINER

```sql
-- Returns workspace_id where user has >= min_role
select workspace_id from public.workspace_members
where user_id = auth.uid()
  and role in ('owner', 'admin', ...);
```

### Prospecting Tables

**Prospects & Signals:**
- `prospects` — identity (first name, last name, email deduction)
- `prospect_signals` — detected signals (job_posting, company_growth, etc.)
- `prospect_profiles` — enriched data (LinkedIn, company size, bouncer_status)
- `prospect_imports` — import batches (CSV, manual)

**Companies & Patterns:**
- `companies` — SIRENE record (INSEE)
- `domain_email_patterns` — deduction [first.last@domain.fr](mailto:first.last@domain.fr) (e.g., Acme Inc → acme.fr)
- `email_verification_cache` — Bouncer/Reoon results cache

**Triggers, Personas, Templates:**
- `prospect_signal_triggers` — signal definition (HR in CDI → score 90+)
- `prospect_icp_personas` — targeting criteria (sector, geography, size)
- `prospect_message_templates` — message templates (email, SMS, LinkedIn)

**Campaigns & Actions:**
- `prospect_batches` — sourcing batch (one campaign = one batch)
- `prospect_enrichment_jobs` — FullEnrich queue
- `prospect_actions` — actions (email sent, call, etc.)
- `extension_tokens` — tokens for Chrome extension (LinkedIn scraping)

**Configuration & Toolbox:**
- `workspace_provider_credentials` — encrypted keys (LLM, FullEnrich, Bouncer, Smartlead)
- `workspace_config` — JSON (LLM models, scoring thresholds, etc.)
- `smartlead_campaigns` — workspace → Smartlead campaign mappings
- `recruitment_agencies_blacklist` — agencies to exclude from scraping

### Edge Functions (38 total)

Each function is:
- HTTP **endpoint** (POST, GET) or **CRON** (recurring job)
- **Zod** validation on inputs
- **JWT** auth via `extractUserId()` (_shared)
- SSRF check via `validateUrlOrThrow()`
- CORS headers via `getCorsHeaders()`

#### Sourcing

| Function | Type | Role |
|----------|------|------|
| `scrape-job-signals` | HTTP POST | Triggers Adzuna / France Travail scrape |
| `poll-batch-reactive` | HTTP POST | Reactive batch polling (short-lived) |
| `poll-prospect-batches` | CRON (15 min) | Regular batch polling |

#### Classification & Archiving

| Function | Type | Role |
|----------|------|------|
| `score-prospect-signals` | HTTP POST | LLM scoring + top-15 archiving |
| `detect-crm` | HTTP POST | Detects company CRM (DNS/web signals) |
| `detect-import-mapping` | HTTP POST | Auto-detects CSV columns on import |

#### Enrichment

| Function | Type | Role |
|----------|------|------|
| `enqueue-enrichment` | HTTP POST | FullEnrich queue |
| `fullenrich-webhook` | HTTP POST | FullEnrich webhook (results) |
| `enrich-company` | HTTP POST | Enrich company (INSEE, size, sector) |
| `enrich-deduced-emails` | HTTP POST | Deduce emails from patterns |
| `expand-prospect-profiles` | HTTP POST | Expand profiles with LinkedIn + Brave |
| `refresh-prospect-linkedin-snapshots` | HTTP POST | Update LinkedIn snapshot |
| `reenrich-companies` | HTTP POST | Re-enrich companies (batch) |

#### Email Validation & Bouncer

| Function | Type | Role |
|----------|------|------|
| `bouncer-batch` | CRON (07h, 13h UTC) | Batch email verification via Bouncer |
| `bouncer-webhook` | HTTP POST | Bouncer webhook (results) |
| `bounce-learning` | CRON (04h UTC) | Bounce rate learning (improves gate) |
| `fullenrich-credits-monitor` | CRON (06h UTC) | Alert on low FullEnrich credits |

#### Message Generation

| Function | Type | Role |
|----------|------|------|
| `generate-prospect-messages-bulk` | HTTP POST | Generate messages (email, SMS, LinkedIn) for batch |
| `regenerate-prospect-messages-from-template` | HTTP POST | Regenerate from template |

#### Outreach (Smartlead & SMTP)

| Function | Type | Role |
|----------|------|------|
| `send-via-smartlead` | HTTP POST | Push prospects → Smartlead campaign |
| `send-prospect-email` | HTTP POST | Direct SMTP sending (optional) |
| `send-contact-email` | HTTP POST | Send email from app |
| `smtp-send-email` | HTTP POST | Generic SMTP (Resend, transactional) |

#### Chrome Extension (LinkedIn Scraping)

| Function | Type | Role |
|----------|------|------|
| `extension-get-status` | HTTP POST | Retrieves extension status + active triggers list |
| `extension-linkedin-next` | HTTP POST | Retrieves next LinkedIn action (invite, message) |
| `extension-linkedin-update` | HTTP POST | Updates action status (invited, error) |
| `extension-get-pending-actions` | HTTP POST | Lists pending actions |
| `extension-update-action-status` | HTTP POST | Marks action as done/failed |
| `extension-disconnect` | HTTP POST | Revokes extension |

#### Maintenance & Crons

| Function | Type | Role |
|----------|------|------|
| `cleanup-expired-prospects` | CRON (midnight UTC) | Archive out-of-scope prospects after 90 days |
| `cleanup-expired-trials` | CRON (01h UTC) | Disables expired trial workspaces |
| `cleanup-stuck-crm-detections` | CRON (02h UTC) | Cleans orphaned CRM detections |
| `linkedin-invitation-enqueue` | HTTP POST | LinkedIn invitations queue |
| `weekly-prospect-recap` | CRON (Monday 08h UTC) | Weekly recap email |
| `prospect-weekly-recap` | CRON (variation) | Alias for recap |
| `wipe-prospection-db` | HTTP POST | RESET DB (dev/test only) |

#### Admin

| Function | Type | Role |
|----------|------|------|
| `enqueue-prospect-import` | HTTP POST | CSV/JSON import queue |
| `parse-import-freetext` | HTTP POST | Parse free text (copy-paste names) |

**`_shared/` module:** 53 Deno files (TS). See [_shared/README.md](../supabase/functions/_shared/README.md) for full details.

---

## Data Model (Simplified)

### User → Workspace → Prospects

```
auth.users (Supabase Auth)
    ↓
profiles (first name, last name, plan)
    ↓
workspaces (1+ per user)
    ↓
workspace_members (role: owner/admin/member/viewer)
    ↓
prospects, prospect_signals, companies (RLS filtered by workspace_id)
```

### RLS (Row-Level Security)

Every `prospect_*` or `company_*` table has a policy:

```sql
create policy "workspace read"
  on prospects for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));
```

Helper function SECURITY DEFINER `user_workspaces(min_role)` short-circuits `workspace_members` RLS to avoid infinite recursion.

### Secret Encryption

Provider API keys (Anthropic, FullEnrich, Bouncer, Smartlead):
- **Table:** `workspace_provider_credentials`
- **Format:** `{ provider_id, workspace_id, encrypted_key }`
- **Encryption:** AES-GCM with `TOKEN_ENCRYPTION_KEY` (Supabase secret)
- **Never in env**: encryption/decryption on edge function side

See **[data-model.md](data-model.md)** for full schema.

---

## Event Flows (Examples)

### Sourcing → Scoring → Push

1. User clicks "Launch sourcing" (UI, Triggers tab)
2. Calls `scrape-job-signals` (HTTP) → creates `prospect_signals` (job_posting)
3. LLM scores each signal → `prospect_signals.score`
4. Top-15 prospects kept, others archived
5. User validates → archiving finalized

### Enrichment

1. User clicks "Enrich batch" (Campaigns tab)
2. Calls `enqueue-enrichment` → creates `prospect_enrichment_jobs`
3. CRON `poll-prospect-batches` checks every 15 min
4. `fullenrich-webhook` populates `prospect_profiles` (email_deduced, linkedin_url)
5. `expand-prospect-profiles` extends with LinkedIn scrape (Apify)

### Email Gate → Smartlead

1. User clicks "Verify deliverability"
2. CRON `bouncer-batch` (07h/13h) → calls Bouncer API
3. `bouncer-webhook` populates `prospect_profiles.bouncer_status`
4. `email-gate.ts` decides: valid → push, risky + high pattern → push optional, invalid → skip
5. User confirms → `send-via-smartlead` pushes to Smartlead campaign

---

## Providers (Pluggable)

### LLM

- **Anthropic Claude** (Haiku, Sonnet) — default
- **OpenAI compatible** (Mistral, etc.)
- **Demo** (test without API key)

Resolve: `resolveProvider(workspace_id, 'llm')` → LLMProvider instance

### Enrichment

- **FullEnrich** — company + contact (deduced email, LinkedIn)
- **Brave Search** + **Apify** — LinkedIn profile scraping
- **INSEE SIRENE** — French legal data

### Email Validation

- **Bouncer** — deliverability verification + bounce rate learning
- **Reoon** — arbitrates Bouncer unknown/risky

### Outreach

- **Smartlead** — cold email campaign, webhook statuses
- **Direct SMTP** (Resend, etc.)

See **[providers.md](providers.md)** to integrate a new provider.

---

## Multi-Tenant Configuration

### Plan Tiers

- **OSS** (free) — 100 prospects/month, limited sourcing, no paid LLM
- **Growth** (paid) — 5k prospects/month, all providers
- **Business** (paid) — unlimited, support

Gating via `subscription-access.ts`.

### Workspace Configuration

Stored in `workspace_config` (JSONB):

```json
{
  "llm_model": "claude-3-5-sonnet-20241022",
  "scoring_threshold": 0.7,
  "email_deduction_confidence": 0.85,
  "bounce_rate_threshold": 0.15,
  "archive_retention_days": 60
}
```

---

## Security

### JWT & Auth

- Edge functions extract user via `extractUserId(req)` (JWT header decoding)
- `subscription-access.ts` gates by plan
- CRON = `service_role` Bearer token (Supabase)

### SSRF Protection

All user URLs pass through `validateUrlOrThrow()` (_shared)

### XSS Protection

- Redirects = relative paths only
- HTML emails escaped via `escapeHtml()`

### CORS

`getCorsHeaders(req)` → dynamic CORS headers (not hardcoded `*`)

### RLS

Every prospect table encrypted by `workspace_id IN (SELECT user_workspaces(...))`

---

## Future Improvements

- [ ] Extraction to OSS standalone repo
- [ ] Bidirectional CRM integration (contact sync)
- [ ] AI-powered follow-up (smart follow-ups)
- [ ] A/B testing templates
- [ ] Direct import from LinkedIn Sales Navigator

---

## Resources

- **[data-model.md](data-model.md)** — Detailed SQL schema
- **[providers.md](providers.md)** — Integrate new providers
- **[self-host.md](self-host.md)** — Deploy to production
- **[_shared/README.md](../supabase/functions/_shared/README.md)** — Deno modules

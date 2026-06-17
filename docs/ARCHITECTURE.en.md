> [Français](ARCHITECTURE.md) | **English**

# Architecture of Jay Reach

## Overview

Jay Reach is a **configurable B2B prospecting engine** for scraping, scoring, and enriching prospects via cold email. Multi-tenant platform where each operator defines their own **triggers** (job postings to monitor), **personas** (targeting criteria), **templates** (messages), and **providers** (LLM, enrichment, email validation, outreach).

Logic is entirely **provider-agnostic**: no trace of any specific product. Each standalone instance configures API keys via the web interface (**Providers** tab).

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
│    FullEnrich: work_email, LinkedIn URL, company metadata       │
│    (Local pattern deduction validation)                         │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. DELIVERABILITY VERIFICATION                                  │
│    Bouncer (+ Reoon arbitration): valid/invalid/risky/disposable│
│    Empirical bounce_rate learning                               │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. EMAIL GATE & OUTREACH                                        │
│    Filtering rules (_shared/email-gate.ts)                      │
│    Push to Smartlead (campaign resolved by persona_id)          │
│    Webhook: send statuses (sent, bounced, replied, opened)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Front-End Architecture

### Routing

The app is a **React 18 SPA** with a single main route:

- **`/`** → `Prospection.tsx` page
  - Tabs (query param `?tab=`): **Companies**, **Triggers**, **Personas**, **Templates**, **Branding**, **Providers**, **Campaigns**
  - `AuthGate` global wrapper (login redirect if unauthenticated)

### Key Components

```
src/
├── App.tsx                  — Router + providers (React Query, Theme, i18n)
├── pages/
│   └── Prospection.tsx      — Main layout, tabs
├── components/
│   ├── auth/                — AuthGate, login/register forms
│   ├── prospection/         — triggers, personas, templates, campaigns, providers
│   └── ui/                  — Radix UI + shadcn/ui (button, input, form, etc.)
├── hooks/
│   └── useProspectionData() — TanStack Query, edge function mutations
├── lib/
│   └── supabase.ts          — Supabase client + real-time listeners
└── locales/                 — i18n FR/EN/NL
```

### Global State & Libraries

- **TanStack Query (v5)**: request caching, edge function mutations
- **Supabase Auth native**: user session, JWT token
- **Next Themes**: dark/light mode
- **React Hook Form + Zod**: forms + validation
- **React i18next**: multilingual translations
- **Tailwind CSS**: styling
- **shadcn/ui (Radix primitives)**: accessible components

---

## Back-End Architecture

### Authentication & Multi-Tenancy

1. **`auth.users`** (Supabase Auth native) — email + password (signup/login)
2. **`profiles`** — extends (first name, last name, current plan)
3. **`workspaces`** — organization (multi-tenant)
4. **`workspace_members`** — membership + role (owner/admin/member/viewer)

**RLS helper function:** `user_workspaces(min_role)` SECURITY DEFINER

```sql
-- Returns workspace_id where user has >= min_role
select workspace_id from public.workspace_members
where user_id = auth.uid()
  and role in ('owner', 'admin', 'member', 'viewer');
```

### Prospecting Tables

**Prospects & Signals:**
- `prospects` — prospect identity (first name, last name, email)
- `prospect_signals` — detected signals (job_posting, etc.)
- `prospect_profiles` — enriched data (work_email deduced, linkedin_url, deliverability_status)
- `prospect_imports` — import batches (CSV, paste free text)

**Companies & Email Patterns:**
- `companies` — company metadata (sector, size, website)
- `domain_email_patterns` — local pattern deduction (first.last@domain.fr)
- `email_verification_cache` — Bouncer/Reoon results (valid/invalid/risky/disposable)

**Prospecting Configuration:**
- `prospect_signal_triggers` — triggers (« Job Postings RH », LLM prompt, score threshold)
- `prospect_icp_personas` — personas (name, description, score boost)
- `prospect_message_templates` — email templates (variables, content)
- `smartlead_campaigns` — mapping persona_id → Smartlead campaign (key **persona_id**)

**Campaigns & Queues:**
- `prospect_batches` — sourcing batch (state: pending/processing/completed)
- `prospect_enrichment_jobs` — FullEnrich queue
- `prospect_actions` — log actions (email sent, bounced, replied, etc.)

**Configuration & Credentials:**
- `workspace_provider_credentials` — **encrypted keys** (Anthropic, FullEnrich, Bouncer, Smartlead)
- `workspace_config` — JSON config (LLM model, thresholds, archive retention, etc.)
- `recruitment_agencies_blacklist` — agencies excluded from scraping

**Optional CRM Detection:**
- `crm_detections` — detected signals (DNS CNAME, TXT, homepage body)
- `crm_detection_providers` — provider list (Zoho, HubSpot, etc.)
- Workspace toggle `crm_detection_enabled` → enable/disable

### Edge Functions (30 total)

Each function is:
- HTTP **endpoint** (POST, GET) OR **CRON** (recurring job, scheduled in Supabase env)
- **Zod** strict validation on inputs
- **JWT** auth via `extractUserId()` (_shared) for HTTP ; `service_role` Bearer token for CRON
- SSRF check via `validateUrlOrThrow()` on all user URLs
- CORS headers via `getCorsHeaders()` (never `*`)

Note: CRONs are NOT scheduled by default. See [self-host.md](self-host.md) §scheduling for `pnpm run setup:crons`.

#### Sourcing (Adzuna + France Travail)

| Function | Type | Role |
|----------|------|------|
| `scrape-job-signals` | HTTP POST | Trigger Adzuna / France Travail scrape |
| `poll-batch-reactive` | HTTP POST | Reactive batch polling (short-lived) |
| `poll-prospect-batches` | **CRON** | Regular batch polling (15 min) |

#### Scoring & Classification

| Function | Type | Role |
|----------|------|------|
| `score-prospect-signals` | HTTP POST | LLM scoring (trigger prompt) + top-15 archiving |
| `detect-crm` | HTTP POST | Detect company CRM (DNS CNAME + fetch homepage + FullEnrich) |
| `detect-import-mapping` | HTTP POST | Auto-detect CSV columns on import |

#### Enrichment (FullEnrich)

| Function | Type | Role |
|----------|------|------|
| `enqueue-enrichment` | HTTP POST | Enqueue prospects for FullEnrich |
| `fullenrich-webhook` | HTTP POST | FullEnrich webhook (populate prospect_profiles: work_email, linkedin_url) |
| `enrich-company` | HTTP POST | Enrich company (size, sector) |
| `enrich-deduced-emails` | HTTP POST | Deduce emails from local patterns |
| `expand-prospect-profiles` | HTTP POST | Extend profiles (used for non-FullEnrich) |
| `reenrich-companies` | HTTP POST | Re-enrich companies (batch) |

#### Email Validation (Bouncer + Reoon)

| Function | Type | Role |
|----------|------|------|
| `bouncer-batch` | **CRON** | Verify emails Bouncer (07h, 13h UTC) |
| `bouncer-webhook` | HTTP POST | Bouncer webhook (populate email_verification_cache, prospect_profiles.bouncer_status) |
| `bounce-learning` | **CRON** | Empirical bounce_rate learning (04h UTC) |
| `fullenrich-credits-monitor` | **CRON** | Alert on low FullEnrich credits (06h UTC) |

#### Message Generation

| Function | Type | Role |
|----------|------|------|
| `generate-prospect-messages-bulk` | HTTP POST | Generate email messages for batch (LLM or template) |
| `regenerate-prospect-messages-from-template` | HTTP POST | Regenerate from template |

#### Outreach (Smartlead)

| Function | Type | Role |
|----------|------|------|
| `send-via-smartlead` | HTTP POST | Push prospects → Smartlead campaign (resolved by **persona_id** in `smartlead_campaigns`) |
| `smartlead-webhook` | HTTP POST | Smartlead webhook (statuses: sent, bounced, replied, opened) |
| `list-smartlead-campaigns` | HTTP POST | List Smartlead campaigns (UI) |

#### Admin & Maintenance

| Function | Type | Role |
|----------|------|------|
| `cleanup-expired-prospects` | **CRON** | Archive out-of-scope prospects after 90 days (midnight UTC) |
| `cleanup-stuck-crm-detections` | **CRON** | Clean orphaned CRM detections (02h UTC) |
| `weekly-prospect-recap` | **CRON** | Weekly recap email (Monday 08h UTC) |
| `prospect-weekly-recap` | **CRON** | Alias for recap |
| `enqueue-prospect-import` | HTTP POST | CSV/JSON import queue |
| `parse-import-freetext` | HTTP POST | Parse free text (copy-paste names) |
| `set-provider-credential` | HTTP POST | Save provider API key (AES-GCM encryption) |
| `test-provider-connection` | HTTP POST | Test provider connection (Smartlead, FullEnrich, etc.) |
| `wipe-prospection-db` | HTTP POST | RESET DB (dev/test only) |

**`_shared/` module (Deno/TS)**: shared helpers (auth, CORS, SSRF, email-gate, providers, encryption). See [_shared/README.md](../supabase/functions/_shared/README.md).

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
prospects, prospect_signals, companies, signals_triggers, icp_personas, message_templates
(RLS filtered by workspace_id)
```

### Persona_ID Model (System Core)

Architecture is centered on **persona_id**: each prospect is targeted per a **specific persona** (e.g., "HR Manager", "Commercial Director").

```
prospect_signal_triggers (triggers)
  ├─ trigger_id, workspace_id, name, source (Adzuna / France Travail)
  ├─ scoring_prompt (LLM)
  └─ score_threshold

prospect_icp_personas (personas)
  ├─ persona_id, workspace_id, name, description
  └─ used in message templates + Smartlead campaigns

prospect_message_templates (templates)
  ├─ template_id, workspace_id, persona_id, subject, body
  └─ one template = one unique (persona_id, trigger_id)

smartlead_campaigns (persistent mapping)
  ├─ workspace_id, persona_id, smartlead_campaign_id
  └─ One persona = one Smartlead campaign
```

**Flow:**
1. Trigger generates prospects + LLM score
2. User assigns prospects to a persona (Campaigns tab)
3. `send-via-smartlead` resolves Smartlead campaign **by persona_id** in `smartlead_campaigns`
4. Prospect sent + Smartlead webhook updates status

### RLS (Row-Level Security)

Every prospect table encrypted by workspace:

```sql
create policy "workspace_read"
  on prospects for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));
```

Helper function SECURITY DEFINER `user_workspaces(min_role)` short-circuits `workspace_members` RLS to avoid infinite recursion.

### Secret Encryption (Token Encryption)

Provider API keys:
- **Table:** `workspace_provider_credentials`
- **Columns:** `workspace_id, provider_id (anthropic/openai_compatible/bouncer/fullenrich/smartlead/reoon), encrypted_key`
- **Encryption:** AES-256-GCM with `TOKEN_ENCRYPTION_KEY` (Supabase secret)
- **Never in env**: decryption on edge function side via `resolveCredential(workspace_id, provider_id)`

**Env fallback:** If no key in DB, tries env vars (`ANTHROPIC_API_KEY`, `SMARTLEAD_API_KEY`, etc.).

See **[data-model.md](data-model.md)** for full SQL schema.

---

## Event Flows (Examples)

### Sourcing → Scoring

1. User configures **Trigger** (Triggers tab): name, source (Adzuna/France Travail), LLM prompt, threshold
2. User clicks "Launch sourcing"
3. `scrape-job-signals` → scrapes Adzuna/France Travail
4. `score-prospect-signals` → LLM evaluates each posting (trigger prompt)
5. Top-15 prospects kept; others archived (recoverable later)

### Enrichment

1. User clicks "Enrich" (Campaigns tab)
2. `enqueue-enrichment` → creates `prospect_enrichment_jobs` (FullEnrich)
3. CRON `poll-prospect-batches` polls every 15 min
4. FullEnrich resolves work_email + linkedin_url → `fullenrich-webhook` populates `prospect_profiles`
5. Local patterns fill in if needed

### Email Verification & Gate

1. `bouncer-batch` (CRON 07h/13h) → calls Bouncer API
2. `bouncer-webhook` populates `email_verification_cache` + `prospect_profiles.bouncer_status` (valid/invalid/risky/disposable)
3. `bounce-learning` (CRON 04h) improves empirical bounce_rate per domain
4. `email-gate.ts` filters:
   - `bouncer_status=valid` → **push**
   - `bouncer_status=risky` + high pattern conf (≥0.85-0.90) → **push optional**
   - empirical bounce_rate > 0.15 on domain → **skip**

### Outreach Smartlead (persona_id-based)

1. User assigns prospects to a **persona** (e.g., "HR Manager")
2. User configures mapping persona → Smartlead campaign (Campaigns tab)
3. User confirms → `send-via-smartlead` pushes to campaign (resolved **by persona_id**)
4. `smartlead-webhook` receives statuses: sent, bounced, replied, opened → populates `prospect_actions`

### Optional CRM Detection

If `crm_detection_enabled` in workspace:
1. User triggers "Detect CRM" (Companies tab)
2. `detect-crm` scans DNS (CNAME, TXT), fetches homepage (SSRF-safe), queries FullEnrich
3. Detects CRM signals (Zoho, HubSpot, Pipedrive, etc.)
4. Populates `crm_detections` (decision aid, no blockers)

---

## Providers (Pluggable)

Each provider is:
- Configured **per workspace** (encrypted keys in `workspace_provider_credentials`)
- Resolved via `resolveCredential(workspace_id, provider_id)` → decrypts + env fallback
- **Demo** provider for testing without keys (env `DEMO_MODE=true`)

### LLM (Scoring)

- **`anthropic`** (default) — Haiku, Sonnet (Claude 3.5)
- **`openai_compatible`** — Mistral, others

### Enrichment

- **`fullenrich`** — only provider (work_email, linkedin_url, company metadata)

### Email Validation

- **`bouncer`** — deliverability + bounce rate learning
- **`reoon`** — arbitrates Bouncer unknown/risky (optional)

### Outreach

- **`smartlead`** — only outreach provider (cold email)

### Optional CRM Detection

- **DNS scanning**: CNAME, TXT (Zoho, HubSpot, Pipedrive, etc.)
- **Web scraping SSRF-safe**: fetch homepage, parse signals
- **FullEnrich**: additional signals

See **[providers.md](providers.md)** to add a new provider.

---

## Multi-Tenant Configuration

### Plans (Paywall Substrate)

Platform supports plans (free/paid). On **OSS self-host**, paywall is **no-op** (no active subscriptions). Structure present for future compat:

- Gating via `subscription-access.ts` (checks workspace plan)
- On self-host: all plans = full access
- Public endpoints (signup, webhooks) strictly managed

### Workspace Configuration

Stored in `workspace_config` (JSONB):

```json
{
  "llm_model": "claude-3-5-sonnet-20241022",
  "llm_provider": "anthropic",
  "scoring_threshold": 0.7,
  "email_deduction_confidence": 0.85,
  "bounce_rate_threshold": 0.15,
  "archive_retention_days": 60,
  "crm_detection_enabled": false
}
```

**Branding tab**: logo, colors, email domain, custom footer (for personalized outreach).

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

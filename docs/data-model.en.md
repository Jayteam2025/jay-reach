> [Français](data-model.md) | **English**

# Data Model — Jay Reach

## Overview

Jay Reach is multi-tenant. Each organization (workspace) has its own prospects, triggers, personas, and configurations. Access is protected by **Row-Level Security (RLS)** Postgres.

---

## Main Tables

### Authentication & Tenancy

#### `auth.users` (Supabase Auth)
- Managed by Supabase — email + password hash
- UUID primary key
- JWT authentication

#### `profiles`
User profile (extension of auth.users).

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  role text default 'admin',                    -- admin|member
  current_plan text default 'oss',              -- oss|growth|business
  created_at timestamptz default now()
);
```

#### `workspaces`
Organization (SaaS tenant).

```sql
create table workspaces (
  id uuid primary key,
  name text not null,
  slug text unique,
  settings jsonb default '{}'::jsonb,           -- branding, LLM model, thresholds
  created_by uuid references auth.users(id),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

#### `workspace_members`
User → workspace membership + role.

```sql
create table workspace_members (
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references auth.users(id),
  role text default 'owner',                    -- owner|admin|member|viewer
  invited_by uuid references auth.users(id),
  joined_at timestamptz default now(),
  primary key (workspace_id, user_id)
);
```

**RLS helper function:**

```sql
create or replace function public.user_workspaces(min_role text default 'viewer')
returns setof uuid language sql stable security definer set search_path = 'public' as $$
  select workspace_id from public.workspace_members
  where user_id = auth.uid()
    and case min_role
      when 'viewer' then role in ('viewer','member','admin','owner')
      when 'member' then role in ('member','admin','owner')
      when 'admin'  then role in ('admin','owner')
      when 'owner'  then role = 'owner'
      else false end;
$$;
```

Used by all workspace-based RLS policies to avoid infinite loops (SECURITY DEFINER).

---

### Prospects & Signals

#### `prospects`
Identity of a prospected person.

```sql
create table prospects (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  first_name text not null,
  last_name text,
  email text,                                    -- deduced or enriched
  company_id uuid references companies(id),
  created_at timestamptz default now()
);
-- RLS: workspace_id in (select user_workspaces('viewer'))
```

#### `prospect_signals`
Signals detected for a prospect (e.g., job posting).

```sql
create table prospect_signals (
  id uuid primary key,
  workspace_id uuid not null,
  prospect_id uuid not null references prospects(id),
  signal_type text not null,                    -- job_posting|company_growth|crm_adoption
  signal_trigger_id uuid references prospect_signal_triggers(id),
  score numeric,                                -- 0-100 (LLM evaluated)
  is_archived boolean default false,
  metadata jsonb,                               -- source, job title, date, etc.
  created_at timestamptz default now()
);
```

#### `prospect_profiles`
Enriched data (FullEnrich, LinkedIn, Bouncer).

```sql
create table prospect_profiles (
  id uuid primary key,
  workspace_id uuid not null,
  prospect_id uuid not null references prospects(id) unique,
  linkedin_url text,
  linkedin_data jsonb,                          -- Apify snapshot
  email_verified text,                          -- deduced|enriched|api
  bouncer_status text,                          -- valid|invalid|risky|disposable|unknown
  bouncer_result jsonb,                         -- full Bouncer response
  company_sector text,
  company_size text,                            -- 1-10|11-50|51-250|etc
  enriched_at timestamptz,
  created_at timestamptz default now()
);
```

#### `prospect_imports`
Batches of CSV/manual imports.

```sql
create table prospect_imports (
  id uuid primary key,
  workspace_id uuid not null,
  import_name text,
  import_type text,                             -- csv|manual|api
  status text default 'pending',                -- pending|processing|completed|failed
  total_rows int,
  successful_rows int,
  mapping jsonb,                                -- mapped columns
  created_at timestamptz default now(),
  completed_at timestamptz
);
```

---

### Companies

#### `companies`
Legal & enriched company data (INSEE SIRENE, FullEnrich).

```sql
create table companies (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  sirene text unique,                           -- INSEE SIREN/SIRET
  website text,
  sector text,                                  -- NAF code
  size_category text,                           -- micro|pme|eti|large
  employees_count int,
  founded_year int,
  location text,
  crm_detected text,                            -- Salesforce|HubSpot|Pipedrive|etc
  crm_detection_metadata jsonb,                 -- detection signals
  enriched_at timestamptz,
  created_at timestamptz default now()
);
```

#### `domain_email_patterns`
Email deduction patterns ([first.last@domain](mailto:first.last@domain)).

```sql
create table domain_email_patterns (
  id uuid primary key,
  workspace_id uuid not null,
  domain text not null,                         -- company.fr
  pattern text not null,                        -- {f}.{l}@{d} = f.l@company.fr
  confidence numeric,                           -- 0-1 (empirical)
  samples int,                                  -- number of observed emails
  bounce_rate numeric,                          -- for learning
  downgraded_at timestamptz,                    -- if bounce_rate > threshold
  downgrade_reason text,
  unique(workspace_id, domain)
);
```

#### `email_verification_cache`
Cache of Bouncer/Reoon results.

```sql
create table email_verification_cache (
  email text primary key,
  workspace_id uuid not null,
  provider text,                                -- bouncer|reoon
  status text,                                  -- valid|invalid|risky|disposable|unknown
  verified_at timestamptz,
  expires_at timestamptz
);
```

---

### Triggers, Personas, Templates

#### `prospect_signal_triggers`
Definition of signals to detect.

```sql
create table prospect_signal_triggers (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,                           -- "HR on permanent contract"
  signal_type text not null,                    -- job_posting|company_growth
  filter_rules jsonb,                           -- {job_title: "HR", contract: "CDI"}
  score_multiplier numeric default 1,           -- 1.0 = neutral, 1.5 = bonus
  is_active boolean default true,
  created_at timestamptz default now()
);
```

#### `prospect_icp_personas`
Targeting criteria (Ideal Customer Profile).

```sql
create table prospect_icp_personas (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,                           -- "Sales Director"
  description text,
  job_titles text[],                            -- ex: ["Sales Director", "VP Sales"]
  sectors text[],                               -- ex: ["Tech", "Finance"]
  company_sizes text[],                         -- ex: ["50-250", "250+"]
  geographies text[],                           -- ex: ["France", "Belgium"]
  signal_triggers uuid[],                       -- references prospect_signal_triggers
  is_active boolean default true,
  created_at timestamptz default now()
);
```

#### `prospect_message_templates`
Customizable message templates (email, SMS, LinkedIn).

```sql
create table prospect_message_templates (
  id uuid primary key,
  workspace_id uuid not null,
  name text not null,
  channel text not null,                        -- email|sms|linkedin|whatsapp
  subject text,                                 -- if email
  body text not null,                           -- template with {{variables}}
  persona_id uuid references prospect_icp_personas(id),
  variables text[],                             -- ex: [{{first_name}}, {{company}}]
  is_default boolean default false,
  created_at timestamptz default now()
);
```

---

### Batches, Jobs, Actions

#### `prospect_batches`
A batch = a sourcing campaign.

```sql
create table prospect_batches (
  id uuid primary key,
  workspace_id uuid not null,
  name text,                                    -- "HR Sourcing 2026-06"
  status text default 'draft',                  -- draft|sourcing|scoring|enriching|ready|sent
  trigger_id uuid references prospect_signal_triggers(id),
  persona_id uuid references prospect_icp_personas(id),
  total_prospects int,
  prospects_sourced int,
  prospects_scored int,
  prospects_enriched int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

#### `prospect_enrichment_jobs`
FullEnrich enrichment queue.

```sql
create table prospect_enrichment_jobs (
  id uuid primary key,
  workspace_id uuid not null,
  batch_id uuid references prospect_batches(id),
  prospect_id uuid references prospects(id),
  status text default 'pending',                -- pending|processing|completed|failed
  fullenrich_request_id text,                   -- FullEnrich API ID
  result jsonb,                                 -- FullEnrich response
  created_at timestamptz default now(),
  completed_at timestamptz
);
```

#### `prospect_actions`
Actions linked to a prospect (email sent, call, etc).

```sql
create table prospect_actions (
  id uuid primary key,
  workspace_id uuid not null,
  prospect_id uuid references prospects(id),
  action_type text not null,                    -- email_sent|message_sent|opened|replied|call
  channel text,                                 -- email|sms|linkedin|whatsapp
  metadata jsonb,                               -- campaign_id, provider, timestamp
  created_at timestamptz default now()
);
```

---

### Configuration & Security

#### `workspace_provider_credentials`
Encrypted API keys (LLM, enrichment, outreach).

```sql
create table workspace_provider_credentials (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  provider_id text not null,                    -- anthropic|fullenrich|bouncer|smartlead
  encrypted_key text not null,                  -- AES-GCM encrypted with TOKEN_ENCRYPTION_KEY
  created_at timestamptz default now(),
  unique(workspace_id, provider_id)
);
```

**Encryption**: in edge functions with `token-encryption.ts`

```typescript
import { encryptToken, decryptToken } from './_shared/token-encryption.ts';

const encrypted = encryptToken(apiKey, encryptionKey);  // store encrypted_key
const decrypted = decryptToken(encrypted, encryptionKey); // decrypt at runtime
```

#### `workspace_config`
Global workspace configuration (JSON).

```sql
create table workspace_config (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) unique,
  llm_model text default 'claude-3-5-sonnet-20241022',
  llm_temperature numeric default 0.7,
  scoring_threshold numeric default 0.7,       -- top-15 vs archived
  email_deduction_confidence numeric default 0.85,
  bounce_rate_threshold numeric default 0.15,
  archive_retention_days int default 60,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

#### `smartlead_campaigns`
Mapping workspace → Smartlead campaign.

```sql
create table smartlead_campaigns (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  persona_id uuid references prospect_icp_personas(id),
  smartlead_campaign_id text not null,          -- Smartlead ID
  smartlead_campaign_name text,
  synced_at timestamptz,
  created_at timestamptz default now()
);
```

#### `recruitment_agencies_blacklist`
HR agencies to exclude from sourcing (Heidrick, Korn Ferry, etc).

```sql
create table recruitment_agencies_blacklist (
  id uuid primary key,
  workspace_id uuid not null,
  agency_name text not null,
  domain_patterns text[],                       -- ex: ["recruiter.fr", "korn*.com"]
  created_at timestamptz default now()
);
```

#### `extension_tokens`
Tokens for Chrome extension (LinkedIn scraping).

```sql
create table extension_tokens (
  id uuid primary key,
  workspace_id uuid not null,
  user_id uuid references auth.users(id),
  token text unique not null,                   -- JWT for extension auth
  browser_id text,
  status text default 'active',                 -- active|revoked|expired
  created_at timestamptz default now(),
  expires_at timestamptz
);
```

---

## Patterns & Best Practices

### RLS Template

Every prospect-related table follows this pattern:

```sql
alter table <table_name> enable row level security;

create policy "workspace_access"
  on <table_name> for all to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')))
  with check (workspace_id in (select public.user_workspaces('admin')));
```

### Types & Zod Schemas

Input validations in edge functions:

```typescript
// supabase/functions/_shared/schemas/common.ts
import { z } from 'https://deno.land/x/zod/mod.ts';

export const ProspectInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  company_id: z.string().uuid().optional(),
});
```

### Secret Encryption

```typescript
// In an edge function
import { decryptToken } from './_shared/token-encryption.ts';

const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY');
const encrypted = await getWorkspaceCredential(workspace_id, 'anthropic');
const api_key = decryptToken(encrypted, encryptionKey);

// Use api_key for API call
```

---

## Migrations & Versioning

SQL migrations are in `supabase/migrations/` with timestamp:

```
20260414120000_create_prospect_tables.sql
20260520110000_workspace_rls_prospect_tables.sql
20260521100000_smartlead_campaigns_workspace_and_persona.sql
...
```

Apply with:

```bash
supabase migration up --project-ref <ref>
```

Or during `pnpm run setup` (local):

```bash
supabase db push
```

---

## Monitoring & Performance

### Key Indexes

```sql
create index idx_prospects_workspace on prospects(workspace_id);
create index idx_prospect_signals_workspace on prospect_signals(workspace_id, signal_type);
create index idx_companies_workspace on companies(workspace_id, sirene);
create index idx_domain_patterns_domain on domain_email_patterns(domain);
```

### Cache & Real-Time

Supabase real-time can be enabled on key tables (prospects, signals) for live UI sync.

### Logs & Audit

`audit_events` table (optional, not implemented here) to track modifications.

---

## Resources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Pipeline, edge functions
- [providers.md](providers.md) — Integrating new providers
- [self-host.md](self-host.md) — Deploy to production
- Supabase Docs: [RLS](https://supabase.com/docs/guides/auth/row-level-security), [Edge Functions](https://supabase.com/docs/guides/functions)

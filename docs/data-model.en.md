> [Français](data-model.md) | **English**

# Data Model — Jay Reach OSS

## Overview

Jay Reach is **multi-tenant workspace-based**. Each organization (workspace) operates its own prospects, signal triggers, personas, and configurations. All access is protected by **Row-Level Security (RLS)** Postgres via the `user_workspaces(min_role)` function, which validates user membership and role in the workspace.

**Generic tone**: zero Jay-specific traces. Configurable B2B prospecting: sourcing → scoring → enrichment → email validation → Smartlead push (or any generic outreach).

---

## Multi-Tenant Architecture

### Authentication & Tenancy Foundation

#### `auth.users` (Supabase Auth)
- Managed by Supabase — email + password hash
- UUID primary key
- JWT authentication

#### `profiles`
User profile (extension of `auth.users`).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | References `auth.users(id)`, cascade DELETE |
| `email` | text | User email |
| `first_name` | text | First name |
| `last_name` | text | Last name |
| `role` | text | `admin` or `member` (profile-level, not workspace) |
| `current_plan` | text | `oss` (default), or commercial plan |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: `self read` (SELECT if `id = auth.uid()`) + `self update` (UPDATE/CHECK if `id = auth.uid()`).

#### `workspaces`
Organization/multi-tenant instance (SaaS tenant).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `name` | text | Workspace name (ex: "My workspace") |
| `slug` | text | Unique slug (ex: "ws-abc12345") |
| `settings` | jsonb | Global config (branding, LLM thresholds, models) |
| `created_by` | uuid (FK) | References `auth.users(id)` |
| `is_active` | bool | `true` default |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: `members read ws` (SELECT if workspace in `user_workspaces('viewer')`) + `members update ws` (UPDATE/CHECK if workspace in `user_workspaces('admin')`).

#### `workspace_members`
User → workspace membership + role.

| Column | Type | Description |
|--------|------|-------------|
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `user_id` | uuid (FK) | References `auth.users(id)`, cascade DELETE |
| `role` | text | `owner`, `admin`, `member`, or `viewer` |
| `invited_by` | uuid (FK) | Who invited the user (ref `auth.users(id)`) |
| `joined_at` | timestamptz | Join date |
| **PK** | | `(workspace_id, user_id)` |

**RLS**: `members read wm` (SELECT if workspace in `user_workspaces('viewer')`).

#### RLS Backbone Function: `user_workspaces(min_role DEFAULT 'viewer')`

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

**Usage**: all workspace-based RLS policies use it. Returns `SETOF uuid` (list of accessible workspace_ids). **SECURITY DEFINER** to bypass `workspace_members` RLS itself (avoids infinite loops).

#### Bootstrap Trigger: `handle_new_user()`

Trigger on every `INSERT` to `auth.users`:
1. Creates `admin` profile in `profiles`
2. Creates default workspace (`'My workspace'`)
3. Adds user as `owner` in `workspace_members`

**All signup users become admin and receive their own OSS workspace.** No domain whitelist.

---

### Signals & Prospecting

#### `prospect_profiles`
Enriched identity of a prospected person (contact).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `first_name` | text | First name (ex: "John") |
| `last_name` | text | Last name (ex: "Smith") |
| `email` | text | Primary email |
| `job_title` | text | Job title |
| `company_name` | text | Company name |
| `company_siren` | text | INSEE SIREN (unique) |
| `company_size` | text | Size (ex: "50-250", "250+") |
| `company_sector` | text | Sector/NAF |
| `company_city` | text | HQ city |
| `company_group_id` | uuid | Logical company grouping |
| `linkedin_url` | text | LinkedIn URL |
| `status` | text | `new`, `qualified`, `in_sequence`, `replied`, `meeting_booked`, `converted`, `lost` |
| `persona_id` | uuid (FK) | Target persona (ref `icp_personas(id)`) |
| `source_signal_id` | uuid (FK) | Signal triggering detection (ref `prospect_signals(id)`) |
| `email_source` | text | Email origin: `deduced`, `fullenrich`, `crm`, `manual`, `imported`, `unknown` |
| `deliverability_status` | text | Validator verdict: `valid`, `invalid`, `risky`, `disposable`, `role`, `unknown` |
| `deliverability_reason` | text | Verdict reason (ex: "mailbox does not exist") |
| `deliverability_checked_at` | timestamptz | When verdict obtained |
| `deliverability_provider` | text | Validator used: `bouncer`, `reoon`, `demo` |
| `smartlead_push_decision` | text | Gate decision: `push`, `skip` |
| `smartlead_push_reason` | text | Gate reason (ex: "bouncer_invalid", "pattern_unknown") |
| `more_available_counts` | jsonb | FullEnrich contact counts (for pagination) |
| `deleted_at` | timestamptz | Soft delete (NULL = active) |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: `members read` (SELECT if workspace in `user_workspaces('viewer')`) / `members insert/update` (if workspace in `user_workspaces('member')`) / `admins delete` (if workspace in `user_workspaces('admin')`).

**Key indices**: `workspace_id`, `persona_id`, `deliverability_status`, `status`, `email_source`, `deleted_at`.

#### `prospect_signals`
Raw signals detected (job postings, LinkedIn activity, Google alerts, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)` |
| `signal_type` | text | `job_posting`, `linkedin_activity`, `google_alert`, etc. |
| `source` | text | Signal source (ex: "Adzuna", "France Travail") |
| `source_url` | text | Source URL |
| `raw_content` | text | Raw signal content (job posting text, etc.) |
| `extracted_data` | jsonb | Structured extracted data (JSON job details) |
| `company_name` | text | Company name detected |
| `matched_prospect_id` | uuid (FK) | Matched contact (ref `prospect_profiles(id)`) |
| `status` | text | `raw`, `matched`, `dismissed` |
| `is_archived` | bool | `false` default; archived if outside top-15 after scoring |
| `detected_at` | timestamptz | When signal found |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: workspace-based (same pattern as `prospect_profiles`).

**Key indices**: `workspace_id`, `status`, `detected_at`, `source`.

#### `prospect_imports`
Batches of CSV/manual imports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)` |
| `user_id` | uuid (FK) | Who triggered import |
| `import_name` | text | Batch name (ex: "Q2 2026 Import") |
| `import_type` | text | `csv`, `manual`, `api` |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `total_rows` | int | Input row count |
| `successful_rows` | int | Created contacts |
| `mapping` | jsonb | Column mapping (CSV → prospect_profiles) |
| `error_log` | jsonb | Detailed errors per row |
| `created_at` | timestamptz | Creation timestamp |
| `completed_at` | timestamptz | When import finished |

**RLS**: `members` (read workspace) / `members insert/update` (own row) / `admin delete`.

---

### Signal Triggers & Personas

#### `signal_triggers`
How to find the right companies (sourcing/scraping filters). Distinct from personas (who to contact).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `slug` | text | Unique identifier per workspace (ex: "recruitment-sales") |
| `label` | text | Readable label (ex: "Sales Recruitment") |
| `description` | text | Detailed description |
| `icon` | text | Icon (emoji or class) |
| `search_keywords` | text[] | Scraping keywords (ex: ["sales", "business development"]) |
| `exclude_keywords` | text[] | Exclusions (ex: ["freelance", "agency"]) |
| `source_types` | text[] | Enabled sources: `adzuna`, `france_travail`, `brave`, `linkedin_jobs`, etc. |
| `company_size_min` | int | Min company size |
| `company_size_max` | int | Max company size |
| `industry_filters` | text[] | Target industries (ex: ["Tech", "Finance"]) |
| `geo_filters` | jsonb | Geographic filters (countries, regions) |
| `signal_scoring_prompt` | text | LLM prompt to qualify signal (is company interesting?) |
| `signal_match_threshold` | int | Confidence threshold (0-100) to keep signal |
| `elimination_rules` | jsonb | Additional elimination rules |
| `is_active` | bool | `true` default |
| `is_default` | bool | One `true` per workspace |
| `created_by` | uuid (FK) | Ref `auth.users(id)` |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: `members read` (viewer) / `admins insert/update/delete`.

**Key indices**: `workspace_id, is_active`, `workspace_id, slug`, `workspace_id, is_default`.

#### `icp_personas`
Who to contact in companies found by signal_triggers.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `slug` | text | Unique identifier (ex: "cfo-enterprise") |
| `name` | text | Label (ex: "Chief Financial Officer") |
| `description` | text | Detailed persona description |
| `job_title_keywords` | text[] | Job title keywords (ex: ["CFO", "Chief Financial", "Finance Chief"]) |
| `seniority_levels` | text[] | Hierarchical levels (ex: ["c_level", "director", "manager"]) |
| `department_patterns` | text[] | Functional roles (ex: ["Finance", "Operations", "Executive"]) |
| `exclude_titles` | text[] | Titles to exclude |
| `persona_scoring_prompt` | text | LLM prompt to evaluate if contact = persona (0-100) |
| `persona_match_threshold` | int | Min score to retain contact (0-100) |
| `is_active` | bool | `true` default |
| `is_default` | bool | One `true` per workspace |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (viewer read, admin insert/update/delete).

**Key indices**: `workspace_id, is_active`, `workspace_id, slug`.

#### `prospect_message_templates`
Prospecting message templates (email, LinkedIn, postal, social DM).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)` |
| `persona_id` | uuid (FK) | References `icp_personas(id)` (can be NULL for legacy templates) |
| `channel` | text | `email`, `linkedin`, `postal_letter`, `social_dm` |
| `subject_variants` | text[] | Subject line variants (email) |
| `opener_variants` | text[] | Opening lines |
| `body` | text | Message body (template with `{{variables}}`) |
| `icebreaker_template` | text | Initial hook |
| `is_active` | bool | `true` default |
| `version` | int | Versioning (auto-incremented on UPDATE) |
| `updated_at` | timestamptz | Update timestamp |
| `updated_by` | uuid (FK) | Who modified |

**RLS**: workspace-based (viewer read, admin insert/update/delete).

**Unique**: `(workspace_id, persona_id, channel)` (1 template per persona and channel).

---

### Providers & Configuration

#### `workspace_providers`
Registry of active providers (Smartlead, FullEnrich, Bouncer, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `category` | text | `outreach` (Smartlead), `validator` (Bouncer), `enricher` (FullEnrich) |
| `provider_type` | text | Provider type (ex: "smartlead", "bouncer", "fullenrich") |
| `channel` | text | Channel (outreach only): `email`, `linkedin`, NULL for validator/enricher |
| `is_active` | bool | `true` if active |
| `config` | jsonb | Configuration (provider-specific schema) |
| `credential_last4` | text | Last 4 key chars (safe UI display) |
| `credential_set_at` | timestamptz | When key was entered |
| `last_test_status` | text | Last test result (`success`, `failed`) |
| `last_test_at` | timestamptz | When last test ran |
| `last_test_detail` | text | Test detail (error message if failed) |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (viewer read, admin insert/update/delete).

**Unique**: `(workspace_id, category, channel, is_active)` (1 active provider per category/channel).

#### `workspace_provider_credentials`
Encrypted API key storage (AES-256-GCM via `token-encryption.ts`).

| Column | Type | Description |
|--------|------|-------------|
| `provider_id` | uuid (PK, FK) | References `workspace_providers(id)`, cascade DELETE |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `encrypted_key` | text | Base64 (IV + ciphertext + auth tag) |
| `last4` | text | Last 4 chars (safe UI display) |
| `set_by` | uuid (FK) | Who entered the key |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: RLS enabled but **no policy = service_role only** (keys must NEVER transit via client PostgREST).

#### `workspace_brand`
Branding and workspace configuration.

| Column | Type | Description |
|--------|------|-------------|
| `workspace_id` | uuid (PK, FK) | References `workspaces(id)`, 1-1 with workspaces |
| `brand_name` | text | Brand name |
| `signature` | text | Email signature |
| `hero_image_url` | text | Header image |
| `founder_name` | text | Founder/author name (replaces `{{founder_name}}` in prompts) |
| `product_pitch` | text | Short product pitch (replaces `{{product_pitch}}`) |
| `app_url` | text | App URL (for links in recap emails) |
| `notification_recipients` | text[] | Email recipients for notifications (empty = no send) |
| `attachments` | jsonb | Attachments (CV inline, etc.): `[{persona_id?, channel?, type, url, alt?}, ...]` |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (viewer read, admin insert/update/delete).

---

### Campaigns & Messages

#### `prospect_batches`
Sourcing campaign (batch of prospects to process together).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `name` | text | Campaign name (ex: "Q2 2026 Sales Sourcing") |
| `status` | text | `draft`, `sourcing`, `scoring`, `enriching`, `ready`, `sent` |
| `trigger_id` | uuid (FK) | Signal trigger used (ref `signal_triggers(id)`) |
| `persona_id` | uuid (FK) | Target persona (ref `icp_personas(id)`) |
| `total_prospects` | int | Total prospects in batch |
| `prospects_sourced` | int | Found |
| `prospects_scored` | int | Qualified |
| `prospects_enriched` | int | Enriched |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (member read/insert/update, admin delete).

**Key indices**: `workspace_id, status`, `workspace_id, persona_id`.

#### `prospect_messages`
Generated prospecting messages for each prospect.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)` |
| `prospect_id` | uuid (FK) | References `prospect_profiles(id)`, cascade DELETE |
| `batch_id` | uuid (FK) | Owning batch (ref `prospect_batches(id)`) |
| `persona_id` | uuid (FK) | Target persona (ref `icp_personas(id)`) |
| `channel` | text | `email`, `linkedin`, `postal_letter`, `social_dm` |
| `subject` | text | Subject (email) |
| `body` | text | Message body |
| `icebreaker` | text | Initial hook |
| `status` | text | `draft`, `approved`, `sent`, `replied`, `bounced` |
| `template_id` | uuid (FK) | Template used (ref `prospect_message_templates(id)`) |
| `template_version` | int | Template version at generation |
| `scheduled_at` | timestamptz | Scheduled send date |
| `sent_at` | timestamptz | Actual send date |
| `replied_at` | timestamptz | First reply date |
| `llm_model` | text | LLM model used (ex: "mistral-medium-3-5") |
| `llm_prompt_hash` | text | Prompt hash (traceability) |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based.

**Key indices**: `workspace_id, prospect_id`, `workspace_id, status`, `workspace_id, channel`.

#### `prospect_actions`
Follow-up actions (sent, opened, replied, clicked, downloaded).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)` |
| `prospect_id` | uuid (FK) | References `prospect_profiles(id)`, cascade DELETE |
| `action_type` | text | `copy`, `open`, `sent`, `download` |
| `channel` | text | `email`, `linkedin`, `instagram`, `tiktok`, `letter`, `postal_letter`, `social_dm` |
| `metadata` | jsonb | Context (campaign_id, timestamp, provider, etc.) |
| `created_at` | timestamptz | Action timestamp |

**RLS**: workspace-based (member insert, admin delete).

---

### Enrichment & Validation

#### `prospect_enrichment_jobs`
FullEnrich enrichment queue per prospect.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `user_id` | uuid (FK) | Who triggered (ref `auth.users(id)`) |
| `batch_id` | uuid (FK) | Associated batch (ref `prospect_batches(id)`, can be NULL) |
| `prospect_id` | uuid (FK) | Main contact (ref `prospect_profiles(id)`) |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `fullenrich_request_id` | text | FullEnrich API ID |
| `result` | jsonb | FullEnrich response (contacts found) |
| `error` | text | Error message if failed |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |
| `completed_at` | timestamptz | When job finished |

**RLS**: workspace-based (member insert/update/read own jobs, admin read all).

#### `prospect_enrichment_job_items`
Contacts found by an enrichment job (N contacts per job).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `job_id` | uuid (FK) | References `prospect_enrichment_jobs(id)`, cascade DELETE |
| `prospect_id` | uuid (FK) | Found contact (ref `prospect_profiles(id)`) |
| `email` | text | Found email |
| `job_title` | text | Job title |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `error` | text | Error if failed |
| `created_at` | timestamptz | Creation timestamp |
| `completed_at` | timestamptz | Completion timestamp |

**RLS**: access via parent job (same user/admin).

#### `bouncer_jobs`
Tracking for Bouncer email verification batches.

| Column | Type | Description |
|--------|------|-------------|
| `job_id` | text (PK) | ID from Bouncer |
| `profile_ids` | uuid[] | Verified contacts in batch |
| `sent_at` | timestamptz | When batch sent |
| `received_at` | timestamptz | When Bouncer webhook responded |
| `status` | text | `pending`, `completed`, `failed`, `timeout` |
| `webhook_payload` | jsonb | Bouncer webhook response |

**RLS**: service_role only (no policy = no client access).

#### `pattern_audit_events`
Audit of email patterns and bounce learning.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `prospect_id` | uuid (FK) | References `prospect_profiles(id)`, cascade DELETE |
| `email` | text | Tested email |
| `domain` | text | Extracted domain |
| `email_source` | text | Email origin: `deduced`, `fullenrich`, `crm`, `manual`, `unknown` |
| `pattern_id` | text | Email pattern ID used |
| `pattern_confidence` | numeric | Pattern confidence (0-1) |
| `fullenrich_status` | text | FullEnrich status |
| `event_type` | text | `generated`, `bouncer_verdict`, `sent`, `bounced`, `replied`, `opened` |
| `event_value` | text | Event value (ex: "invalid" for bouncer_verdict) |
| `occurred_at` | timestamptz | Event timestamp |

**RLS**: service_role (bounce-learning backend).

**Key indices**: `prospect_id`, `domain, pattern_id`, `event_type`.

#### `smartlead_campaigns`
Mapping persona → Smartlead campaign.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `persona_id` | uuid (FK) | References `icp_personas(id)`, cascade DELETE |
| `campaign_id` | text | Smartlead ID (string) |
| `campaign_name` | text | Smartlead name |
| `enabled` | bool | `true` default |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (viewer read, admin insert/update/delete).

**Unique**: `(workspace_id, persona_id)` (1 Smartlead campaign per persona).

#### `smartlead_events`
Raw Smartlead webhook events (sent, opened, replied, bounced, clicked).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `prospect_id` | uuid (FK) | Matched contact (ref `prospect_profiles(id)`, can be NULL) |
| `lead_email` | text | Smartlead lead email |
| `campaign_id` | bigint | Smartlead campaign ID |
| `event_type` | text | Event type (sent, opened, replied, bounced, clicked) |
| `subject` | text | Message subject |
| `message` | text | Content |
| `email_account` | text | Email account used |
| `raw_payload` | jsonb | Full webhook payload |
| `created_at` | timestamptz | Received timestamp |

**RLS**: service_role only (Smartlead webhook).

**Key indices**: `prospect_id`, `event_type`, `created_at DESC`.

---

### CRM Detection & Utilities

#### `prospect_crm_detections`
Detection of CRMs used by companies (CRM adoption signals).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `company_group_id` | uuid | Logical company grouping |
| `prospect_id` | uuid (FK) | Source contact (ref `prospect_profiles(id)`, can be NULL) |
| `crm_type` | text | Detected CRM: `salesforce`, `hubspot`, `pipedrive`, `zoho`, etc. |
| `confidence` | numeric | Detection confidence (0-1) |
| `signals` | jsonb | Detected signals (ex: `{email_domain: "company.salesforce.com"}`) |
| `attempts` | int | Detection attempt count |
| `detected_at` | timestamptz | When detection occurred |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Update timestamp |

**RLS**: workspace-based (member read/insert/update, admin delete).

#### `recruitment_agencies_blacklist`
HR agencies to exclude from sourcing (Heidrick, Korn Ferry, etc).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | References `workspaces(id)`, cascade DELETE |
| `agency_name` | text | Agency name (ex: "Heidrick & Struggles") |
| `domain_patterns` | text[] | Domain patterns (ex: `["recruiter.fr", "korn*.com"]`) |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: workspace-based.

---

### Backend Utilities

#### `enrichment_cache`
Cache of expensive API results (company lookup, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `cache_type` | text | Cache type (ex: "company_lookup") |
| `cache_key` | text | Lookup key (ex: SIREN) |
| `data` | jsonb | Cached value |
| `created_at` | timestamptz | Creation timestamp |
| `expires_at` | timestamptz | TTL expiration |

**Unique**: `(cache_type, cache_key)`.

**RLS**: service_role only.

#### `pending_fullenrich_bulks`
FullEnrich webhook cache (rate-limit mitigation).

| Column | Type | Description |
|--------|------|-------------|
| `enrichment_id` | text (PK) | FullEnrich ID |
| `webhook_payload` | jsonb | Received webhook payload |
| `received_at` | timestamptz | When response received |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: service_role only.

#### `api_rate_limits`
Rate limiting for edge functions (imports, public webhooks).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `identifier` | text | IP or user_id |
| `identifier_type` | text | `ip`, `user` |
| `endpoint_category` | text | `oauth`, `webhook`, `admin`, `api`, `public` |
| `request_count` | int | Request counter |
| `window_start` | timestamptz | Window start |
| `created_at` | timestamptz | Creation timestamp |

**RLS**: admin read, service_role write.

#### `edge_function_logs`
Application logs from edge functions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid (FK) | Who triggered (ref `profiles(id)`) |
| `function_name` | text | Function name |
| `status` | text | `success`, `error`, `warning` |
| `message` | text | Log message |
| `metadata` | jsonb | Additional context |
| `created_at` | timestamptz | Log timestamp |

**RLS**: users read own logs, admins read all.

#### `validation_errors`
Zod validation error logs (warn mode, non-blocking).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `function_name` | text | Logging function |
| `errors` | jsonb | Structured Zod errors |
| `received_data` | text | Problematic data |
| `user_id` | uuid (FK) | Affected user_id |
| `created_at` | timestamptz | Log timestamp |

**RLS**: admin read.


---

## Patterns & Best Practices

### RLS Backbone: `user_workspaces(min_role)`

All prospect-related tables use this uniform pattern:

```sql
alter table <table_name> enable row level security;

-- Read (viewer or above)
create policy "members read" on <table_name> for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));

-- Modify (member or above)
create policy "members insert" on <table_name> for insert to authenticated
  with check (workspace_id in (select public.user_workspaces('member')));

create policy "members update" on <table_name> for update to authenticated
  using (workspace_id in (select public.user_workspaces('member')))
  with check (workspace_id in (select public.user_workspaces('member')));

-- Delete (admin/owner only)
create policy "admins delete" on <table_name> for delete to authenticated
  using (workspace_id in (select public.user_workspaces('admin')));
```

**Special cases**:
- `prospect_data_access_logs`: GDPR audit, DELETE = owner only
- `prospect_message_templates`: SELECT/INSERT/UPDATE = admin only (after workspace_id added)
- `smartlead_events`, `bouncer_jobs`, `enrichment_cache`: service_role only, no policy

### Secret Encryption

API keys stored in `workspace_provider_credentials.encrypted_key`:

```typescript
// Encryption (edge function, before storage)
import { encryptToken } from './_shared/token-encryption.ts';

const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY');
const encrypted = encryptToken(apiKey, encryptionKey);  // base64 (IV + ciphertext + tag)
// INSERT: encrypted_key = encrypted

// Decryption (edge function, at runtime)
import { decryptToken } from './_shared/token-encryption.ts';

const encrypted = await getWorkspaceCredential(workspace_id, 'smartlead');
const apiKey = decryptToken(encrypted, encryptionKey);
// Use apiKey for Smartlead API call
```

**IMPORTANT**: credentials must NEVER transit via client PostgREST. Edge functions access secrets via service_role (bypass RLS).

---

## Migrations & Versioning

SQL migrations in `supabase/migrations/` with ISO timestamp (YYYYMMDDHHMMSS):

```
00000000000000_socle.sql                                   — Multi-tenant foundation
20260414120000_create_prospect_tables.sql                  — Prospects, signals (legacy)
20260520100000_workspace_jay_and_backfill_prospect_tables.sql
20260520110000_workspace_rls_prospect_tables.sql           — Workspace-based RLS
20260520130000_split_icp_into_triggers_and_personas.sql    — signal_triggers + icp_personas
20260525090000_workspace_providers_generic.sql             — workspace_providers
20260603120000_workspace_provider_credentials.sql          — Encrypted key storage
20260616120000_complete_oss_schema.sql                     — workspace_brand, smartlead_campaigns
20260616230000_drop_dead_tables.sql                        — Cleanup extension_tokens, linkedin_invitation_queue
20260617010000_drop_target_category_legacy.sql             — Drop legacy target_category
```

Apply with:

```bash
supabase db push                           # local (linked project)
supabase migration up --project-ref <ref>  # remote
```

---

## Monitoring & Performance

### Critical Indices

```sql
-- Workspace-based lookups
create index idx_prospect_profiles_workspace on prospect_profiles(workspace_id);
create index idx_prospect_profiles_persona on prospect_profiles(persona_id) where deleted_at is null;
create index idx_prospect_profiles_deliverability on prospect_profiles(deliverability_status) 
  where deliverability_status = 'valid';

-- Signal processing
create index idx_prospect_signals_workspace_status on prospect_signals(workspace_id, status, detected_at);

-- Email deduction (bounce learning)
create index idx_pattern_audit_events_domain_pattern on pattern_audit_events(domain, pattern_id);

-- Enrichment jobs
create index idx_prospect_enrichment_jobs_status on prospect_enrichment_jobs(workspace_id, status);

-- Fuzzy search (pg_trgm)
create index idx_prospect_profiles_company_trgm on prospect_profiles using gin (company_name gin_trgm_ops);
```

### Real-Time (Supabase)

Real-time can be enabled on:
- `prospect_profiles` (deliverability/persona_id changes)
- `prospect_signals` (new detections)
- `prospect_messages` (sends, replies)

```typescript
// Example React
const subscription = supabase
  .channel('prospect_profiles')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'prospect_profiles', 
      filter: `workspace_id=eq.${workspaceId}` },
    (payload) => { /* handle change */ }
  )
  .subscribe();
```

### Security

- **RLS mandatory** on all prospect-related tables. No access without `user_workspaces()`.
- **Encrypted secrets**: credentials never plaintext. Decrypt in edge function (service_role bypass).
- **Rate limiting**: `api_rate_limits` to protect webhooks/imports.
- **Audit**: `pattern_audit_events` for email decisions, `edge_function_logs` for debug.

---

## Resources

- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) — Full pipeline, edge functions
- [ADR 0003 — Multi-tenant Workspace](../docs/ADR.md#adr-0003-multi-tenant-workspace-id) — Architectural decisions
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security) — Row-level security
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) — Deno functions

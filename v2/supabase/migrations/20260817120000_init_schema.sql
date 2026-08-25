-- ============================================================================
-- T2 — Schéma initial Jay Reach (docs/02-data-model.md)
-- Multi-tenant : chaque table métier porte organization_id. RLS activée
-- séparément (voir 20260817120100_rls.sql).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------
create type membership_role as enum ('owner', 'admin', 'operator', 'viewer');
create type signal_kind as enum ('job_posting', 'appointment', 'tradeshow');
create type signal_resolution as enum ('pending', 'resolved', 'unresolved', 'rejected');
create type signal_status as enum ('new', 'qualified', 'discarded', 'enrolled');
create type list_origin as enum ('import', 'manual', 'filter');
create type seniority_level as enum ('executive', 'director', 'manager', 'individual');
create type email_status as enum ('unknown', 'valid', 'risky', 'invalid');
create type contact_status as enum ('active', 'left_company', 'do_not_contact');
create type campaign_status as enum ('draft', 'active', 'paused', 'archived');
create type channel_kind as enum ('email', 'linkedin_invite', 'linkedin_message', 'letter', 'call');
create type enrollment_status as enum ('active', 'paused', 'paused_absence', 'completed', 'stopped', 'replied', 'bounced');
create type action_status as enum ('scheduled', 'pending_approval', 'blocked', 'approved', 'dispatched', 'delivered', 'failed', 'skipped', 'cancelled');
create type call_outcome as enum ('reached', 'not_reached', 'callback', 'wrong_person', 'not_interested');
create type outcome_type as enum ('sent', 'opened', 'clicked', 'replied', 'bounced', 'invite_accepted', 'letter_printed', 'letter_delivered', 'unsubscribed');
create type sender_kind as enum ('email', 'linkedin', 'postal');
create type suppression_scope as enum ('email', 'domain', 'linkedin', 'postal', 'account');
create type suppression_origin as enum ('manual', 'unsubscribe', 'bounce', 'customer_import', 'sirene_opposition', 'api');
create type thread_direction as enum ('in', 'out');
create type thread_classification as enum ('human_reply', 'auto_absence', 'auto_left_company', 'auto_other', 'unclassified');
create type notification_channel as enum ('email', 'push');
create type notification_digest as enum ('instant', 'hourly', 'daily');
create type customer_list_source as enum ('csv', 'crm_sync');

-- ---------------------------------------------------------------------------
-- Organisation & accès
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_locale text not null default 'fr',
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_id text not null,
  secret bytea,
  config jsonb not null default '{}',
  status text not null default 'unconfigured',
  last_checked_at timestamptz,
  unique (organization_id, provider_id)
);

-- ---------------------------------------------------------------------------
-- Sources & signaux
-- ---------------------------------------------------------------------------
create table sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_id text not null,
  name text not null,
  config jsonb not null default '{}',
  schedule text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table source_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  cursor jsonb,
  items_found int not null default 0,
  items_new int not null default 0,
  error text
);

-- accounts (déclarée avant signals pour la FK account_id)
create table accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  legal_name text,
  siren text,
  naf_code text,
  domain text,
  linkedin_url text,
  headcount int,
  city text,
  postal_code text,
  country text,
  locale text,
  postal_address jsonb,
  postal_address_verified_at timestamptz,
  postal_address_verified_by uuid references auth.users(id),
  prospecting_opposition boolean not null default false,
  is_customer boolean not null default false,
  enrichment jsonb,
  enriched_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index accounts_org_siren_uidx on accounts (organization_id, siren) where siren is not null;
create unique index accounts_org_domain_uidx on accounts (organization_id, domain) where domain is not null;
create index accounts_name_trgm on accounts using gin (name gin_trgm_ops);

create table signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_id uuid references sources(id) on delete set null,
  provider_id text,
  external_id text not null,
  kind signal_kind not null,
  occurred_at timestamptz not null,
  raw jsonb,
  title text,
  url text,
  company_hint text,
  location text,
  account_id uuid references accounts(id) on delete set null,
  resolution_status signal_resolution not null default 'pending',
  score int check (score between 0 and 100),
  score_reason text,
  scored_at timestamptz,
  status signal_status not null default 'new',
  discard_reason text,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index signals_org_status_idx on signals (organization_id, status, occurred_at desc);
create index signals_raw_gin on signals using gin (raw);

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
create table personas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  title_patterns text[] not null default '{}',
  title_exclusions text[] not null default '{}',
  seniority seniority_level,
  angle text,
  default_campaign_id uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  persona_id uuid references personas(id) on delete set null,
  first_name text,
  last_name text,
  job_title text,
  locale text,
  email text,
  email_status email_status not null default 'unknown',
  email_confidence numeric,
  linkedin_url text,
  linkedin_provider_id text,
  photo_url text,
  enrichment jsonb,
  enriched_at timestamptz,
  source_signal_id uuid references signals(id) on delete set null,
  source_list_id uuid,
  status contact_status not null default 'active',
  created_at timestamptz not null default now()
);
create unique index contacts_org_email_uidx on contacts (organization_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- Listes & imports
-- ---------------------------------------------------------------------------
create table lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  context_note text not null,
  origin list_origin not null,
  source_file_name text,
  imported_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table list_members (
  list_id uuid not null references lists(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  raw_row jsonb,
  primary key (list_id, contact_id)
);

alter table contacts add constraint contacts_source_list_fk
  foreign key (source_list_id) references lists(id) on delete set null;

create table imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  file_name text not null,
  rows_total int not null default 0,
  rows_unique int not null default 0,
  rows_merged int not null default 0,
  mapping jsonb,
  status text not null default 'pending',
  list_id uuid references lists(id) on delete set null,
  created_at timestamptz not null default now()
);

create table customer_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  source customer_list_source not null,
  last_synced_at timestamptz,
  entries_count int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Campagnes, templates, séquences
-- ---------------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status campaign_status not null default 'draft',
  source_id uuid references sources(id) on delete set null,
  list_id uuid references lists(id) on delete set null,
  entry_rules jsonb not null default '{}',
  daily_cap int,
  approval_policy jsonb not null default '{}',
  letter_monthly_budget_eur numeric,
  created_at timestamptz not null default now(),
  constraint campaigns_one_source check (num_nonnulls(source_id, list_id) = 1)
);

alter table personas add constraint personas_default_campaign_fk
  foreign key (default_campaign_id) references campaigns(id) on delete set null;

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  channel channel_kind not null,
  locale text not null,
  version int not null default 1,
  subject text,
  body text not null,
  sent_count int not null default 0,
  parent_id uuid references message_templates(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (parent_id, version, locale)
);

create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  position int not null,
  channel channel_kind not null,
  delay_hours int not null default 0,
  template_parent_id uuid references message_templates(id) on delete set null,
  conditions jsonb not null default '{}',
  stop_on text[] not null default '{}',
  call_brief text,
  unique (campaign_id, position)
);

-- ---------------------------------------------------------------------------
-- Envoi : senders & liaisons
-- ---------------------------------------------------------------------------
create table senders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind sender_kind not null,
  provider_id text,
  identity text not null,
  display_name text,
  daily_quota int,
  hourly_quota int,
  warmup_stage int not null default 0,
  timezone text not null default 'Europe/Paris',
  business_hours jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table contact_sender_bindings (
  contact_id uuid not null references contacts(id) on delete cascade,
  sender_id uuid not null references senders(id) on delete cascade,
  bound_at timestamptz not null default now(),
  primary key (contact_id, sender_id)
);

-- ---------------------------------------------------------------------------
-- Inscriptions, actions, résultats
-- ---------------------------------------------------------------------------
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  signal_id uuid references signals(id) on delete set null,
  list_id uuid references lists(id) on delete set null,
  status enrollment_status not null default 'active',
  current_step int not null default 0,
  next_action_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  stop_reason text,
  resume_at timestamptz
);
-- Protection anti-double-envoi : une seule inscription en cours par contact.
create unique index enrollments_one_active_uidx on enrollments (contact_id)
  where status in ('active', 'paused', 'paused_absence');

create table actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  step_id uuid references sequence_steps(id) on delete set null,
  channel channel_kind not null,
  sender_id uuid references senders(id) on delete set null,
  status action_status not null default 'scheduled',
  block_reason text,
  scheduled_for timestamptz,
  dispatch_after timestamptz,
  template_id uuid references message_templates(id) on delete set null,
  payload jsonb,
  cost_eur numeric,
  provider_ref text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  dispatched_at timestamptz,
  error text,
  idempotency_key text not null unique,
  call_outcome call_outcome,
  call_notes text,
  call_callback_at timestamptz,
  created_at timestamptz not null default now()
);
create index actions_org_status_idx on actions (organization_id, status);

create table outcomes (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions(id) on delete cascade,
  type outcome_type not null,
  occurred_at timestamptz not null default now(),
  raw jsonb
);

-- ---------------------------------------------------------------------------
-- Suppressions
-- ---------------------------------------------------------------------------
create table suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope suppression_scope not null,
  value text not null,
  reason text,
  origin suppression_origin not null default 'manual',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index suppressions_lookup_idx on suppressions (organization_id, scope, value);

-- ---------------------------------------------------------------------------
-- Réception
-- ---------------------------------------------------------------------------
create table threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  channel channel_kind not null,
  provider_thread_id text,
  last_message_at timestamptz,
  is_read boolean not null default false,
  assigned_to uuid references auth.users(id),
  classification thread_classification not null default 'unclassified',
  resume_at timestamptz,
  created_at timestamptz not null default now()
);

create table thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  direction thread_direction not null,
  body text,
  sent_at timestamptz,
  provider_message_id text,
  headers jsonb,
  raw jsonb
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  channel notification_channel not null,
  event text not null,
  enabled boolean not null default true,
  digest notification_digest not null default 'instant',
  primary key (user_id, organization_id, channel, event)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  keys jsonb,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  payload jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  channel notification_channel not null
);

-- ---------------------------------------------------------------------------
-- Traçabilité — append-only (voir RLS + trigger anti-update/delete)
-- ---------------------------------------------------------------------------
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  diff jsonb,
  created_at timestamptz not null default now()
);

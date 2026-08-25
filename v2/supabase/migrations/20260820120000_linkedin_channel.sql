-- ============================================================================
-- T22 — Canal LinkedIn. File d'actions (invitations + messages) alimentée par
-- le séquenceur et consommée par l'extension Chrome (envoi via l'API interne
-- Voyager de LinkedIn, avec la propre session de l'utilisateur). Reprise de
-- l'approche de l'extension interne « Jay » (JB), généralisée aux messages.
-- Le pacing (plafond 7 j, fenêtre horaire, intervalle) est appliqué côté serveur.
-- Aucun secret ici : l'extension s'authentifie par un jeton dédié (extension_tokens).
-- ============================================================================

-- File d'actions LinkedIn ------------------------------------------------------
create table linkedin_action_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  signal_id uuid references signals(id) on delete set null,
  linkedin_url text not null,
  kind text not null check (kind in ('invite', 'message')),
  -- Corps du message (null pour une invitation : elle part sans note).
  message_body text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  method text not null default 'extension_auto' check (method in ('extension_auto', 'manual')),
  attempts int not null default 0,
  scheduled_for timestamptz not null default now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Une seule action active (pending/processing/sent) par contact et par type.
create unique index uq_linkedin_action_active
  on linkedin_action_queue (contact_id, kind)
  where status in ('pending', 'processing', 'sent') and contact_id is not null;
create index idx_linkedin_action_org_status on linkedin_action_queue (organization_id, status);
create index idx_linkedin_action_org_sent on linkedin_action_queue (organization_id, sent_at desc)
  where status = 'sent';
create index idx_linkedin_action_sched on linkedin_action_queue (scheduled_for)
  where status = 'pending';

-- Réglages LinkedIn par organisation (le « curseur » : mode + volume/jour) ------
create table linkedin_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- auto = tout automatique ; hybrid = une part manuelle ; manual = tout à la main.
  mode text not null default 'auto' check (mode in ('auto', 'hybrid', 'manual')),
  -- Volume quotidien souhaité, sous le plafond dur (200 / 7 j).
  daily_cap int not null default 25 check (daily_cap between 0 and 200),
  updated_at timestamptz not null default now()
);

-- Jetons d'extension : identité par organisation, validée côté serveur ---------
create table extension_tokens (
  token text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Validation du jeton (appelée par les endpoints de l'extension). Renvoie
-- l'organization_id, ou NULL si le jeton est inconnu/désactivé.
create or replace function app.validate_extension_token(p_token text)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid;
begin
  update extension_tokens set last_used_at = now()
    where token = p_token and is_active = true
    returning organization_id into v_org;
  return v_org;
end $$;

-- RLS ------------------------------------------------------------------------
alter table linkedin_action_queue enable row level security;
alter table linkedin_action_queue force row level security;
alter table linkedin_settings enable row level security;
alter table linkedin_settings force row level security;
alter table extension_tokens enable row level security;
alter table extension_tokens force row level security;

-- File : lecture membre, écriture operator+. Config/jetons : admin+.
select app._gen_org_policies('linkedin_action_queue', 'operator');
select app._gen_org_policies('linkedin_settings', 'admin');
select app._gen_org_policies('extension_tokens', 'admin');

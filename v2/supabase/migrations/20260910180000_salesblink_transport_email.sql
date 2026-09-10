-- Transport email SalesBlink (lot 3) : liaison des expediteurs, objets SalesBlink par etape, curseur de releve.
-- Additive seulement : le retrait de Smartlead arrive dans une migration distincte, appliquee au deploiement.

alter table public.senders
  add column if not exists provider_ref text,
  add column if not exists provider_state jsonb;
comment on column public.senders.provider_ref is 'Identifiant de la boite chez le transport (SalesBlink : id d''expediteur).';
comment on column public.senders.provider_state is 'Derniere sante relevee chez le transport : connected, sending_enabled, health_score, checked_at, last_error.';

create table if not exists public.email_transport_bindings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  step_id uuid not null references public.sequence_steps(id) on delete cascade,
  provider text not null default 'salesblink',
  sequence_id text not null,
  list_id text not null,
  template_id text not null,
  created_at timestamptz not null default now(),
  last_replanned_at timestamptz,
  primary key (organization_id, campaign_id, step_id)
);
comment on table public.email_transport_bindings is 'Sequence, liste et gabarit SalesBlink crees pour une etape email d''une campagne.';

create table if not exists public.provider_sync_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  cursor_ms bigint not null default 0,
  last_run_at timestamptz,
  last_error text,
  primary key (organization_id, provider)
);
comment on table public.provider_sync_state is 'Curseur et dernier resultat de la releve periodique d''un fournisseur (SalesBlink : since en millisecondes).';

-- RLS : lecture par les membres de l''organisation, ecriture par le worker (service_role) seulement.
alter table public.email_transport_bindings enable row level security;
alter table public.email_transport_bindings force row level security;
alter table public.provider_sync_state enable row level security;
alter table public.provider_sync_state force row level security;

-- Lecture : tout membre de l''organisation (viewer+), meme forme que smartlead_campaign_mappings_read.
drop policy if exists email_transport_bindings_read on public.email_transport_bindings;
create policy email_transport_bindings_read on public.email_transport_bindings
  for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

drop policy if exists provider_sync_state_read on public.provider_sync_state;
create policy provider_sync_state_read on public.provider_sync_state
  for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

-- Aucune policy d''ecriture pour authenticated : le worker ecrit en service_role, qui contourne la RLS.
-- Supabase accorde par defaut tous les privileges a `anon` et `authenticated`
-- sur toute table creee dans `public` : un simple `revoke ... from public` ne
-- les reprend pas (motif suivi depuis la migration 20260909120000).
revoke all on public.email_transport_bindings from anon;
revoke insert, update, delete, truncate, references, trigger on public.email_transport_bindings from authenticated;
grant select on public.email_transport_bindings to authenticated;
grant select, insert, update, delete on public.email_transport_bindings to service_role;

revoke all on public.provider_sync_state from anon;
revoke insert, update, delete, truncate, references, trigger on public.provider_sync_state from authenticated;
grant select on public.provider_sync_state to authenticated;
grant select, insert, update, delete on public.provider_sync_state to service_role;

-- ============================================================================
-- Mapping campagne Smartlead PAR PERSONA (parité v1, review #20).
--
-- Le canal email du séquenceur pousse les leads vers une campagne Smartlead. La
-- bonne granularité est la PERSONA, pas la campagne Jay Reach : on n'écrit pas la
-- même chose à un Directeur de site et à un Responsable RH, donc ils ne vont pas
-- dans la même séquence Smartlead. Le socle v1 mappe `(workspace, persona) →
-- campagne` ; on reprend cette forme, avec `enabled` pour suspendre un envoi sans
-- perdre l'identifiant, et `campaign_name` pour l'affichage dans l'onglet Campagnes.
--
-- Plusieurs personas peuvent pointer vers la MÊME campagne Smartlead (unicité par
-- (org, persona), pas par campagne). Multi-tenant (règle CLAUDE.md #5).
-- ============================================================================

-- Nettoyage de la première approche (colonne au niveau campagne) : un mapping par
-- campagne ne peut exprimer ni deux personas vers une même campagne, ni le toggle
-- `enabled`. `if exists` : no-op sur une base fraîche où elle n'a jamais existé.
alter table public.campaigns
  drop column if exists smartlead_campaign_id;

create table if not exists public.smartlead_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un mapping par (organisation, persona) : une persona → une campagne Smartlead.
-- Deux personas peuvent partager une campagne (aucune contrainte sur campaign_id).
create unique index if not exists uq_smartlead_campaigns_org_persona
  on public.smartlead_campaigns (organization_id, persona_id);
create index if not exists idx_smartlead_campaigns_lookup
  on public.smartlead_campaigns (organization_id, persona_id) where enabled;

alter table public.smartlead_campaigns enable row level security;
alter table public.smartlead_campaigns force row level security;

-- Lecture : tout membre de l'organisation (viewer+).
drop policy if exists smartlead_campaigns_read on public.smartlead_campaigns;
create policy smartlead_campaigns_read on public.smartlead_campaigns
  for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

-- Écriture : admin+ (configuration des campagnes, cf. matrice des rôles).
drop policy if exists smartlead_campaigns_write on public.smartlead_campaigns;
create policy smartlead_campaigns_write on public.smartlead_campaigns
  for all to authenticated
  using (organization_id in (select app.user_orgs('admin')))
  with check (organization_id in (select app.user_orgs('admin')));

grant select, insert, update, delete on public.smartlead_campaigns to authenticated, service_role;

comment on table public.smartlead_campaigns is
  'Mapping (organisation, persona) → campagne Smartlead pour le canal email. enabled = false suspend l''envoi sans perdre l''identifiant. Plusieurs personas peuvent partager une campagne.';

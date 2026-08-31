-- Une campagne peut puiser dans plusieurs thèmes de veille (retour 8.1).
--
-- `campaigns.source_id` n'acceptait qu'un thème, et la contrainte
-- `campaigns_one_source` imposait exactement une entrée. Une prospection réelle
-- croise plusieurs veilles — les offres commerciales et les nominations, par
-- exemple — et devait jusqu'ici dupliquer la campagne pour chacune.
--
-- Le dédoublonnage à l'entrée est déjà assuré : `enrollments_one_active_uidx`
-- n'autorise qu'une inscription vivante par contact, toutes campagnes
-- confondues. Un prospect remonté par deux thèmes n'entre donc qu'une fois,
-- sans qu'il y ait rien à ajouter (retour 8.2).
create table if not exists campaign_sources (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, source_id)
);

create index if not exists campaign_sources_source_idx on campaign_sources (source_id);

-- Reprise : chaque campagne alimentée par un thème garde le sien.
insert into campaign_sources (campaign_id, source_id)
select id, source_id from campaigns where source_id is not null
on conflict do nothing;

-- La contrainte devient « au plus une entrée héritée », le lien vivant étant
-- porté par la table de liaison. Une contrainte CHECK ne peut pas regarder une
-- autre table : la cohérence « au moins une entrée » est vérifiée côté
-- applicatif, où le message d'erreur peut être lisible.
alter table campaigns drop constraint if exists campaigns_one_source;
alter table campaigns add constraint campaigns_one_source
  check (num_nonnulls(source_id, list_id) <= 1);

comment on column campaigns.source_id is
  'Déprécié : les thèmes d''une campagne vivent dans campaign_sources. Conservé le temps que les instances migrent.';

alter table campaign_sources enable row level security;
alter table campaign_sources force row level security;

drop policy if exists campaign_sources_read on public.campaign_sources;
create policy campaign_sources_read on public.campaign_sources for select to authenticated
  using (exists (select 1 from public.campaigns c
    where c.id = campaign_sources.campaign_id and c.organization_id in (select app.user_orgs('viewer'))));

drop policy if exists campaign_sources_write on public.campaign_sources;
create policy campaign_sources_write on public.campaign_sources for all to authenticated
  using (exists (select 1 from public.campaigns c
    where c.id = campaign_sources.campaign_id and c.organization_id in (select app.user_orgs('admin'))))
  with check (exists (select 1 from public.campaigns c
    where c.id = campaign_sources.campaign_id and c.organization_id in (select app.user_orgs('admin'))));

-- Une source devient un thème de veille, auquel on rattache des fournisseurs.
--
-- Jusqu'ici une source valait pour un fournisseur : les mots-clés étaient donc
-- saisis une fois par fournisseur, et rien ne garantissait qu'ils décrivent la
-- même veille. Sur la base de recette, les deux sources actives avaient dérivé
-- au point de ne plus rien avoir en commun — « Adzuna — maintenance
-- industrielle » cherchait des techniciens de maintenance (766 signaux) pendant
-- que « France Travail » cherchait des commerciaux (1149 signaux). Les deux
-- alimentaient le même entonnoir, scoré par les mêmes personas.
--
-- Le thème porte donc ce qu'on cherche (nom, descriptif, mots-clés, zone,
-- consigne de qualification) et le rattachement porte où on le cherche.
--
-- `sources` reste la table du thème plutôt qu'une nouvelle table : elle est
-- déjà référencée par `signals.source_id` et par `source_runs`, et 1915 signaux
-- y pointent. La renommer aurait demandé de réécrire ces liens sans rien
-- apporter.

-- Le descriptif demandé sur la carte du thème.
alter table sources add column if not exists description text;

-- Un thème peut exister sans fournisseur rattaché — c'est même l'état d'une
-- veille qu'on vient de créer.
alter table sources alter column provider_id drop not null;

comment on column sources.provider_id is
  'Déprécié : le rattachement vit dans source_providers. Conservé le temps que les instances migrent.';

create table if not exists source_providers (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  provider_id text not null,
  -- Réglages propres au fournisseur (identifiants de catégorie, options d'API).
  -- Ce qui décrit la veille elle-même appartient au thème, pas ici.
  config jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Rattacher deux fois le même fournisseur au même thème collecterait deux
  -- fois les mêmes annonces.
  unique (source_id, provider_id)
);

create index if not exists source_providers_source_idx on source_providers (source_id);

-- Reprise de l'existant : chaque source devient un thème d'un seul fournisseur,
-- celui qu'elle portait. Idempotent, la contrainte d'unicité absorbe un rejeu.
insert into source_providers (source_id, provider_id, is_active)
select id, provider_id, is_active from sources where provider_id is not null
on conflict (source_id, provider_id) do nothing;

-- Traçabilité par fournisseur : sans cette colonne, deux fournisseurs d'un même
-- thème écriraient des exécutions indistinguables, et une panne chez l'un
-- passerait pour une panne du thème entier.
alter table source_runs add column if not exists source_provider_id uuid references source_providers(id) on delete set null;
create index if not exists source_runs_provider_idx on source_runs (source_provider_id);

-- RLS : table enfant sans organization_id, on remonte au thème. Lecture pour
-- tout membre, écriture admin — comme `sources`, dont elle est la suite.
alter table source_providers enable row level security;
alter table source_providers force row level security;

drop policy if exists source_providers_read on public.source_providers;
create policy source_providers_read on public.source_providers for select to authenticated
  using (exists (select 1 from public.sources s
    where s.id = source_providers.source_id and s.organization_id in (select app.user_orgs('viewer'))));

drop policy if exists source_providers_write on public.source_providers;
create policy source_providers_write on public.source_providers for all to authenticated
  using (exists (select 1 from public.sources s
    where s.id = source_providers.source_id and s.organization_id in (select app.user_orgs('admin'))))
  with check (exists (select 1 from public.sources s
    where s.id = source_providers.source_id and s.organization_id in (select app.user_orgs('admin'))));

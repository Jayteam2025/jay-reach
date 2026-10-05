-- Lot 4a, tâche 6 (suite) : unicité d'un engageur, d'une personne et de ce
-- qu'on a écarté. La valeur `post_engagement` a été commitée par la migration
-- précédente, elle est donc utilisable dans un prédicat d'index.

-- Un engageur par (organisation, post:personne). Restreint au kind : un unique
-- (source_id, external_id) existe déjà, et un index global sur
-- (organization_id, external_id) casserait la même annonce Adzuna reprise sur
-- deux thèmes de veille.
create unique index signals_post_engagement_uidx
  on signals (organization_id, external_id)
  where kind = 'post_engagement';

-- Une personne LinkedIn, un contact. Partiel : sans la clause, deux contacts
-- sans adresse LinkedIn (tous ceux nés d'un signal d'entreprise) entreraient en
-- conflit. L'unicité existante ne porte que sur l'email : un engageur sans email
-- serait sinon recréé à chaque passage.
create unique index contacts_org_linkedin_url_uidx
  on contacts (organization_id, linkedin_url)
  where linkedin_url is not null;

-- Mémoire de ce que le scoring a écarté. Le signal et son contact sont effacés
-- (on ne garde pas de données personnelles sur ce qui ne sert pas), mais sans
-- cette trace le collecteur recréerait, scorerait et payerait la même personne
-- à chaque passage.
create table linkedin_engageurs_ecartes (
  organization_id uuid not null references organizations(id) on delete cascade,
  external_id text not null,
  scored_at timestamptz not null default now(),
  primary key (organization_id, external_id)
);

alter table linkedin_engageurs_ecartes enable row level security;
alter table linkedin_engageurs_ecartes force row level security;

-- Un journal, pas un réglage : les membres le lisent, seul le worker (clé de
-- service) y écrit.
create policy linkedin_engageurs_ecartes_read on public.linkedin_engageurs_ecartes for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

-- Contrôle : la migration échoue si l'objet attendu est absent.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'signals_post_engagement_uidx'
       and indexdef ilike '%where%post_engagement%'
  ) then
    raise exception 'index manquant ou non restreint : signals_post_engagement_uidx';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'contacts_org_linkedin_url_uidx'
       and indexdef ilike '%linkedin_url is not null%'
  ) then
    raise exception 'index manquant ou non partiel : contacts_org_linkedin_url_uidx';
  end if;
  if to_regclass('public.linkedin_engageurs_ecartes') is null then
    raise exception 'linkedin_engageurs_ecartes absente';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.linkedin_engageurs_ecartes'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RLS non activée sur linkedin_engageurs_ecartes';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'linkedin_engageurs_ecartes' and cmd = 'SELECT'
  ) then
    raise exception 'politique de lecture manquante sur linkedin_engageurs_ecartes';
  end if;
end $$;

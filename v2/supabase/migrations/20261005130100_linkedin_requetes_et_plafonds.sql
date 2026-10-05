-- Trace par requête de la collecte LinkedIn du serveur.
--
-- Le plafond horaire borne les requêtes réellement émises vers LinkedIn, pas
-- les personnes collectées : un post qui livre 200 engageurs en 4 requêtes
-- coûte 4. Les compteurs de `source_runs` sont des agrégats par passage avec
-- une seule date de démarrage ; ils ne permettent ni de compter à l'heure
-- près ni de répartir une collecte à cheval sur minuit. D'où une ligne par
-- requête, horodatée au moment où elle part.
--
-- Les deux plafonds (`linkedin_posts_par_jour`, défaut 3, repli
-- LINKEDIN_POSTS_DAILY_CAP ; `linkedin_requetes_par_heure`, défaut 60, repli
-- LINKEDIN_REQUESTS_HOURLY_CAP) suivent le motif de `scoring_par_jour` : une
-- ligne de `organization_settings` quand l'opérateur les règle, sinon
-- l'environnement, sinon le défaut du code. Aucune ligne à poser ici.
--
-- Aucune clé, aucune URL, aucun contenu de page : seulement qui, quel passage,
-- quand.

create table linkedin_requetes (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  source_run_id uuid not null references source_runs(id) on delete cascade,
  requested_at timestamptz not null default now()
);

create index linkedin_requetes_org_date_idx on linkedin_requetes (organization_id, requested_at);

alter table linkedin_requetes enable row level security;
alter table linkedin_requetes force row level security;

select app._gen_org_policies('linkedin_requetes', 'admin');

-- Contrôle : la migration échoue si l'objet attendu est absent.
do $$
declare
  v_col text;
begin
  if to_regclass('public.linkedin_requetes') is null then
    raise exception 'linkedin_requetes absente';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.linkedin_requetes'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RLS non activée sur linkedin_requetes';
  end if;
  foreach v_col in array array['organization_id', 'source_run_id', 'requested_at'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'linkedin_requetes' and column_name = v_col
    ) then
      raise exception 'colonne manquante : linkedin_requetes.%', v_col;
    end if;
  end loop;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'linkedin_requetes' and indexname = 'linkedin_requetes_org_date_idx'
  ) then
    raise exception 'index manquant : linkedin_requetes_org_date_idx';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'linkedin_requetes') < 2 then
    raise exception 'politiques RLS manquantes sur linkedin_requetes';
  end if;
end $$;

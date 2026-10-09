-- Lot 4b, étape 2 : la mémoire des posts déjà collectés, par source.
--
-- La page entreprise relevée le 09/10 annonce 501 posts et n'en sert que dix par
-- requête, toujours les mêmes en tête. Sans cette trace, une source suivie en
-- continu relirait les mêmes posts à chaque passage, brûlerait le plafond de
-- posts du jour, et n'ajouterait plus une seule personne dès le deuxième tour.
--
-- Pourquoi une table plutôt que de déduire des signaux déjà écrits : un post
-- traité qui n'a produit AUCUN engageur ne laisse aucune ligne dans `signals`.
-- C'est précisément le post qu'on relirait sans fin, et celui qui coûte le plus
-- cher pour le moins de rendement.
create table linkedin_posts_traites (
  organization_id uuid not null references organizations(id) on delete cascade,
  -- La source, pas seulement l'organisation : deux sources peuvent légitimement
  -- viser le même post (une page concurrente et un mot-clé), et chacune tient sa
  -- propre avance. Les écarter globalement ferait taire la seconde.
  source_id uuid not null references sources(id) on delete cascade,
  -- L'URN d'activité canonique (`urn:li:activity:<n>`), celui que `urnDActivite`
  -- rend des deux côtés : le trouveur et le collecteur d'engageurs reconnaissent
  -- ainsi un post sous une seule identité.
  --
  -- En clair, contrairement à `linkedin_engageurs_ecartes` qui n'en garde qu'une
  -- empreinte : cette table-ci ne désigne que des publications publiques, aucune
  -- personne. Le compromis n'est donc pas le même, et un URN lisible se diagnostique.
  post_urn text not null,
  collected_at timestamptz not null default now(),
  primary key (organization_id, source_id, post_urn)
);

alter table linkedin_posts_traites enable row level security;
alter table linkedin_posts_traites force row level security;

-- Un journal, pas un réglage : les membres le lisent, seul le worker (clé de
-- service) y écrit.
create policy linkedin_posts_traites_read on public.linkedin_posts_traites for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

-- Contrôle : la migration échoue si l'objet attendu est absent.
do $$
begin
  if to_regclass('public.linkedin_posts_traites') is null then
    raise exception 'linkedin_posts_traites absente';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.linkedin_posts_traites'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RLS non activée sur linkedin_posts_traites';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'linkedin_posts_traites' and cmd = 'SELECT'
  ) then
    raise exception 'politique de lecture manquante sur linkedin_posts_traites';
  end if;
  -- La clé primaire doit porter la SOURCE, sinon deux sources se censurent.
  if not exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.linkedin_posts_traites'::regclass and i.indisprimary
       and pg_get_indexdef(i.indexrelid) ilike '%source_id%'
  ) then
    raise exception 'clé primaire de linkedin_posts_traites sans source_id';
  end if;
end $$;

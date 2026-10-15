-- Lot « accroche du post » : conserver l'identité du post qui a fait réagir une personne.
--
-- Les trois sources LinkedIn d'engageurs jetaient tout ce qu'on sait du post. Pour écrire
-- « je vous ai vu réagir au post de X sur Y », il faut une fiche par post, validée avant
-- d'être citée dans un message, et le rattachement du signal à cette fiche.
create table public.linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Nullable : une page de post illisible ne rend pas d'URN.
  post_urn text,
  -- Identité de comparaison, rendue par `normaliserUrlPost` (`linkedin:<chiffres>`, URL
  -- normalisée ou chaîne brute en minuscules). Unicité simple, sans prédicat : un index
  -- partiel obligerait chaque `on conflict` à répéter le même prédicat.
  post_key text not null,
  url text not null,
  author_kind text check (author_kind in ('person', 'page')),
  author_name text,
  author_display_name text,
  author_public_name text,
  author_url text,
  posted_at timestamptz,
  text_excerpt text,
  subject text,
  subject_origin text check (subject_origin in ('model', 'operator')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  expires_at timestamptz not null,
  capture_attempts integer not null default 0,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, post_key)
);

create index linkedin_posts_org_review_idx on public.linkedin_posts (organization_id, review_status);

-- La garde d'accroche (`linkedin/accroche-post.ts`) joint `message_templates` par `parent_id`
-- dans CINQ sous-requêtes : une par variable de post, plus la question « cette campagne nomme-t-elle
-- un post ». AUCUN index à poser ici : `message_templates_parent_id_version_locale_key`, l'unique
-- (parent_id, version, locale) du schéma initial, porte déjà `parent_id` en colonne de tête et sert
-- cette jointure (vérifié par EXPLAIN, contrôle 24a du harnais). Un index dédié n'apporterait que
-- de la compacité, contre un coût d'écriture à chaque gabarit enregistré.

alter table public.linkedin_posts enable row level security;
alter table public.linkedin_posts force row level security;

-- Les membres lisent ; seul le worker (clé de service) écrit.
create policy linkedin_posts_read on public.linkedin_posts for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

alter table public.signals
  add column linkedin_post_id uuid references public.linkedin_posts(id) on delete set null;

create index signals_linkedin_post_idx on public.signals (linkedin_post_id);

-- Reprise de l'existant : seulement les signaux `post_engagement`, les seuls qui viennent d'un post
-- (les recherches par mots-clés et les changements de poste n'ont qu'une adresse de recherche ou de profil).
-- Reproduit `normaliserUrlPost` (packages/core/src/fonctions/sources.ts) :
-- identifiant d'activité pour un hôte LinkedIn, sinon hôte sans `www.` + chemin sans barre
-- finale (paramètres et ancre retirés), sinon chaîne brute en minuscules sans barre finale.
create function pg_temp.cle_post(p_url text) returns text language plpgsql immutable as $$
declare
  brut text := btrim(p_url);
  lisible text := replace(replace(brut, '%3A', ':'), '%3a', ':');
  m text[];
  hote text;
  linkedin boolean;
  activite text[];
begin
  m := regexp_match(brut, '^([A-Za-z][A-Za-z0-9+.-]*:)//([^/?#]+)([^?#]*)');
  if m is null then
    return regexp_replace(lower(brut), '/+$', '');
  end if;
  hote := regexp_replace(lower(m[2]), '^www\.', '');
  linkedin := hote = 'linkedin.com' or hote like '%.linkedin.com';
  if linkedin then
    activite := regexp_match(lisible, '(?:activity|ugcPost|share)[-:](\d+)', 'i');
    if activite is not null then
      return 'linkedin:' || activite[1];
    end if;
    hote := 'linkedin.com';
  end if;
  return lower(m[1]) || '//' || hote || regexp_replace(m[3], '/+$', '');
end $$;

create function pg_temp.urn_post(p_url text) returns text language plpgsql immutable as $$
declare
  a text[] := regexp_match(replace(replace(p_url, '%3A', ':'), '%3a', ':'), '(activity|ugcPost|share)[-:](\d+)', 'i');
begin
  if a is null then
    return p_url;
  end if;
  return 'urn:li:' || case lower(a[1]) when 'activity' then 'activity' when 'ugcpost' then 'ugcPost' else 'share' end || ':' || a[2];
end $$;

-- La fenêtre de décision de CHAQUE organisation, pas 28 jours pour tout le monde : une valeur en
-- dur ici donnerait aux fiches de la reprise une échéance que l'écran Réglages › LinkedIn
-- n'annonce pas, et `expires_at` n'est posé qu'à la création — aucune recapture ne la corrigerait.
--
-- Mêmes garde-fous qu'à la lecture (`fenetreValidationPost`, apps/worker) : une valeur qui n'est
-- pas un nombre strictement positif retombe sur le défaut. Le défaut, 28, est celui de
-- `CLES_REGLAGES` (packages/core/src/fonctions/plafonds.ts).
--
-- UNE marche de la chaîne de repli manque, et c'est assumé : le SQL ne lit pas l'environnement,
-- donc une instance qui n'aurait réglé que `LINKEDIN_POST_REVIEW_WINDOW_DAYS` reçoit 28 jours pour
-- ses fiches de reprise. Elle n'en a qu'une fournée, et le réglage en base vaut pour toutes les
-- suivantes.
create function pg_temp.fenetre_validation(p_org uuid) returns int language sql stable as $$
  select coalesce(
    (select case
              when (os.value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' and trunc((os.value #>> '{}')::numeric) > 0
              then trunc((os.value #>> '{}')::numeric)::int
            end
       from public.organization_settings os
      where os.organization_id = p_org
        and os.key = 'linkedin_fenetre_validation_post_jours'),
    28);
$$;

-- Les fiches que CETTE migration crée, retenues pour que le bloc de vérification ne juge qu'elles.
-- En production la table vient de naître, donc toutes ses lignes sont les nôtres ; le harnais, lui,
-- rejoue la reprise sur une base où d'autres sections ont déjà posé leurs fiches.
create temporary table if not exists reprise_fiches (id uuid primary key);
truncate reprise_fiches;

with nouvelles as (
  insert into public.linkedin_posts (organization_id, post_key, post_urn, url, expires_at)
  select s.organization_id, pg_temp.cle_post(s.url), min(pg_temp.urn_post(s.url)), min(s.url),
         now() + make_interval(days => pg_temp.fenetre_validation(s.organization_id))
    from public.signals s
   where s.kind = 'post_engagement'
     and s.url is not null
   group by s.organization_id, pg_temp.cle_post(s.url)
  on conflict (organization_id, post_key) do nothing
  returning id
)
insert into reprise_fiches (id) select id from nouvelles;

update public.signals s
   set linkedin_post_id = p.id
  from public.linkedin_posts p
 where s.kind = 'post_engagement'
   and s.url is not null
   and p.organization_id = s.organization_id
   and p.post_key = pg_temp.cle_post(s.url);

-- La migration se vérifie elle-même.
do $$
begin
  if to_regclass('public.linkedin_posts') is null then
    raise exception 'linkedin_posts absente';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'signals' and column_name = 'linkedin_post_id'
  ) then
    raise exception 'colonne signals.linkedin_post_id absente';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.linkedin_posts'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, post_key)'
  ) then
    raise exception 'unicité (organization_id, post_key) manquante sur linkedin_posts';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.linkedin_posts'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RLS non activée sur linkedin_posts';
  end if;
  if exists (
    select 1 from public.signals s
     where s.kind = 'post_engagement'
       and s.url is not null and s.linkedin_post_id is null
  ) then
    raise exception 'des signaux post_engagement avec une url restent sans linkedin_post_id';
  end if;
  -- Chaque fiche de la reprise porte la fenêtre de SON organisation (une minute de marge : le
  -- `now()` de l'insertion et celui du `created_at` par défaut ne sont pas le même appel).
  if exists (
    select 1 from public.linkedin_posts p
     where p.id in (select id from reprise_fiches)
       and p.expires_at not between
             p.created_at + make_interval(days => pg_temp.fenetre_validation(p.organization_id)) - interval '1 minute'
         and p.created_at + make_interval(days => pg_temp.fenetre_validation(p.organization_id)) + interval '1 minute'
  ) then
    raise exception 'une fiche de reprise n''a pas la fenêtre de validation de son organisation';
  end if;
  -- Une recherche par mots-clés ou un changement de poste ne vient d'aucun post : leur url est
  -- une adresse de recherche ou de profil, jamais une fiche à capturer.
  if exists (
    select 1 from public.signals s
     where s.kind = any('{people_search,job_change}'::signal_kind[]) and s.linkedin_post_id is not null
  ) then
    raise exception 'un signal people_search ou job_change est rattaché à une fiche de post';
  end if;
end $$;

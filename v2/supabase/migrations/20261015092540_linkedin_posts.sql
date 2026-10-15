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
-- un post ». Cette colonne n'avait aucun index. Aujourd'hui la table tient en une page, donc le
-- parcours séquentiel ne se voit pas — mais le coût de la garde croît comme le nombre de contacts
-- sans inscription vivante multiplié par le nombre de campagnes actives, et c'est exactement ce que
-- la collecte LinkedIn fait grossir. Une ligne ici évite d'avoir à revenir sur ces requêtes.
create index if not exists message_templates_parent_idx on public.message_templates (parent_id);

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

insert into public.linkedin_posts (organization_id, post_key, post_urn, url, expires_at)
select s.organization_id, pg_temp.cle_post(s.url), min(pg_temp.urn_post(s.url)), min(s.url),
       now() + interval '28 days'
  from public.signals s
 where s.kind = 'post_engagement'
   and s.url is not null
 group by s.organization_id, pg_temp.cle_post(s.url)
on conflict (organization_id, post_key) do nothing;

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
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.message_templates'::regclass
       and i.indnatts = 1
       and (select a.attname from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'parent_id'
  ) then
    raise exception 'index de jointure sur message_templates(parent_id) absent';
  end if;
  if exists (
    select 1 from public.signals s
     where s.kind = 'post_engagement'
       and s.url is not null and s.linkedin_post_id is null
  ) then
    raise exception 'des signaux post_engagement avec une url restent sans linkedin_post_id';
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

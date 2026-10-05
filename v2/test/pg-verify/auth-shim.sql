-- Shim minimal pour vérifier le schéma hors Supabase (Postgres nu).
-- En vrai, `auth.users` et `auth.uid()` sont fournis par Supabase Auth.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- auth.uid() lit un GUC de test au lieu du JWT.
create or replace function auth.uid() returns uuid
  language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;

-- Schema `extensions` : Supabase le fournit, un Postgres nu non. Sans lui, la
-- migration 20260826120000 s'arrête sur « schema "extensions" does not exist »
-- dès la 16e des 58 migrations, et tous les harnais tournent en ON_ERROR_STOP.
create schema if not exists extensions;

-- `pgcrypto` DANS `extensions`, et il faut le poser ICI, avant la première
-- migration. Sur Supabase, la plateforme l'a déjà installé là ; sur un Postgres
-- nu, c'est `20260817120000_init_schema.sql` qui le crée en premier, sans
-- schéma — il atterrit donc dans `public`. Le `create extension if not exists
-- pgcrypto with schema extensions` de `20260826120000` ne le DÉPLACE pas (il
-- voit l'extension et passe son chemin), et `20260828140000` s'arrête alors sur
-- « function extensions.digest(text, unknown) does not exist ».
--
-- Mesuré le 05/10 : treize harnais sur vingt et un en échec après une remise à
-- zéro de la base de développement, tous sur cette seule ligne manquante. Les
-- harnais Docker la posaient chacun de leur côté ; elle vit désormais ici, avec
-- le reste des préalables de la plateforme.
create extension if not exists pgcrypto with schema extensions;

-- …et `extensions` dans le chemin de recherche de la base, car toutes les
-- migrations ne préfixent pas : `20260817120200_invitations.sql` appelle
-- `gen_random_bytes()` nu, et s'arrête sans cela sur « function
-- gen_random_bytes(integer) does not exist ». Sur la base courante, quel que
-- soit son nom — les harnais la nomment `jayreach`, la base de développement
-- aussi, mais rien ne l'impose. Prend effet à la connexion suivante, ce qui
-- suffit : chaque migration est jouée par un `psql` distinct.
do $$ begin
  execute format('alter database %I set search_path = public, extensions', current_database());
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  -- `anon` n'était pas posé ici : la migration 20260909120000 lui révoque des
  -- droits sur `credentials_public` et échouait sur « role "anon" does not
  -- exist », 46e migration. Deux harnais récents le créaient chacun de leur
  -- côté plutôt que de corriger le shim ; il est posé une fois pour toutes.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

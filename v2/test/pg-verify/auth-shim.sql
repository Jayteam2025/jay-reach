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

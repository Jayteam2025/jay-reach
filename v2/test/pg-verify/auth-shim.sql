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

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

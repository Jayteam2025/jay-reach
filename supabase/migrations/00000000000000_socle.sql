-- ============================================================================
-- JAY REACH OSS — SOCLE (auth / workspaces / profiles / extension tokens)
-- ============================================================================
-- Cree les fondations multi-tenant : authentification, workspaces, membres,
-- et les tokens pour les extensions. Pas de email_domain_whitelist.
-- La trigger handle_new_user() cree automatiquement le profil admin + workspace
-- pour chaque nouvel utilisateur.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. NOTE: pg_net extension is managed by Supabase and should be pre-installed
-- ---------------------------------------------------------------------------
-- Migrations will reference net.http_post() which is available via pg_net

-- ---------------------------------------------------------------------------
-- 1. TABLE: profiles (extension de auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  role text not null default 'admin' check (role in ('admin','member')),
  current_plan text not null default 'oss',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "self read"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "self update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. TABLE: workspaces (organisations/instances)
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;

-- ---------------------------------------------------------------------------
-- 3. TABLE: workspace_members (multi-tenant membership)
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.workspace_members enable row level security;

-- ---------------------------------------------------------------------------
-- 4. FUNCTION: user_workspaces(min_role) — RLS helper
-- ---------------------------------------------------------------------------
-- Retourne les workspace_id ou auth.uid() a >= min_role.
-- Utilisee par toutes les RLS policies workspace-based.
-- SECURITY DEFINER pour bypasser la RLS de workspace_members (evite recursion).
create or replace function public.user_workspaces(min_role text default 'viewer')
returns setof uuid language sql stable security definer set search_path = 'public' as $$
  select workspace_id from public.workspace_members
  where user_id = auth.uid()
    and case min_role
      when 'viewer' then role in ('viewer','member','admin','owner')
      when 'member' then role in ('member','admin','owner')
      when 'admin'  then role in ('admin','owner')
      when 'owner'  then role = 'owner'
      else false end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES: workspaces
-- ---------------------------------------------------------------------------
create policy "members read ws"
  on public.workspaces for select to authenticated
  using (id in (select public.user_workspaces('viewer')));

create policy "members update ws"
  on public.workspaces for update to authenticated
  using (id in (select public.user_workspaces('admin')))
  with check (id in (select public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- 6. RLS POLICIES: workspace_members
-- ---------------------------------------------------------------------------
create policy "members read wm"
  on public.workspace_members for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));

-- ---------------------------------------------------------------------------
-- 7. FUNCTION: handle_new_user() — Bootstrap signup
-- ---------------------------------------------------------------------------
-- Trigger sur auth.users.INSERT : cree un profil admin + workspace + membre owner.
-- Pas de email_domain_whitelist : tous les users deviennent admin par defaut.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare new_ws uuid;
begin
  insert into public.profiles (id, email, role, current_plan)
  values (new.id, new.email, 'admin', 'oss')
  on conflict (id) do nothing;

  insert into public.workspaces (name, slug, created_by)
  values ('Mon workspace', 'ws-' || left(new.id::text, 8), new.id)
  returning id into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (new_ws, new.id, 'owner', new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 8. TABLE: extension_tokens (Chrome extension + API)
-- ---------------------------------------------------------------------------
create table if not exists public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  name text,
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.extension_tokens enable row level security;

create policy "self all tokens"
  on public.extension_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 9. INDEX: workspace_members lookup
-- ---------------------------------------------------------------------------
create index if not exists idx_workspace_members_user_id
  on public.workspace_members(user_id);

-- Stockage workspace des cles providers, chiffre applicatif (AES-256-GCM via encryptToken).
-- Remplace Supabase Vault (illisible cote edge via PostgREST).

create table if not exists public.workspace_provider_credentials (
  provider_id   uuid primary key references public.workspace_providers(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  encrypted_key text not null,   -- base64 (AES-256-GCM, IV prefixe + tag) via encryptToken()
  last4         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  set_by        uuid references auth.users(id)
);

create index if not exists idx_wpc_workspace
  on public.workspace_provider_credentials(workspace_id);

-- RLS active SANS policy : seul le service_role (bypass RLS) accede au secret chiffre.
alter table public.workspace_provider_credentials enable row level security;

-- Metadonnees d'affichage sures (lisibles client via workspace_providers).
alter table public.workspace_providers
  add column if not exists credential_last4  text,
  add column if not exists credential_set_at timestamptz,
  add column if not exists last_test_status  text,
  add column if not exists last_test_at      timestamptz,
  add column if not exists last_test_detail  text;

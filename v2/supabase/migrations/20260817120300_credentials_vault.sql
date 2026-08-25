-- ============================================================================
-- T5 — Coffre à credentials. Secrets chiffrés via pgcrypto (pgp_sym_encrypt),
-- la clé (ENCRYPTION_KEY) vit hors base, côté serveur/worker. Le secret n'est
-- jamais lisible côté client : le membre ne voit qu'une vue sans secret.
-- ============================================================================

alter table credentials add column if not exists last4 text;
alter table credentials add column if not exists updated_at timestamptz not null default now();

-- Durcissement : le secret (même chiffré) n'est lisible que par un admin.
drop policy if exists credentials_read on public.credentials;
create policy credentials_read on public.credentials for select to authenticated
  using (organization_id in (select app.user_orgs('admin')));

-- Vue sûre pour les membres : provider + statut + 4 derniers caractères, JAMAIS le secret.
create or replace view public.credentials_public
  with (security_invoker = true) as
  select id, organization_id, provider_id, config, status, last4, last_checked_at, updated_at
  from public.credentials;
grant select on public.credentials_public to authenticated;

-- ---------------------------------------------------------------------------
-- Écriture/lecture du secret : fonctions privilégiées appelées UNIQUEMENT par
-- le serveur/worker (service_role). La clé de chiffrement est passée en argument
-- depuis l'environnement serveur, jamais stockée ni exposée au navigateur.
-- ---------------------------------------------------------------------------
create or replace function app.set_credential(
  p_org uuid, p_provider text, p_secret text, p_key text, p_config jsonb default '{}'
) returns text
language plpgsql security definer set search_path = public, app as $$
declare v_last4 text;
begin
  if coalesce(p_key, '') = '' then
    raise exception 'clé de chiffrement manquante';
  end if;
  v_last4 := right(p_secret, 4);
  insert into credentials (organization_id, provider_id, secret, config, status, last4, updated_at)
    values (p_org, p_provider, pgp_sym_encrypt(p_secret, p_key), coalesce(p_config, '{}'),
            'configured', v_last4, now())
  on conflict (organization_id, provider_id) do update
    set secret = excluded.secret, config = excluded.config, status = 'configured',
        last4 = excluded.last4, updated_at = now();
  return v_last4;
end $$;

create or replace function app.get_credential(p_org uuid, p_provider text, p_key text)
returns text
language plpgsql security definer set search_path = public, app as $$
declare v_secret bytea;
begin
  select secret into v_secret from credentials
    where organization_id = p_org and provider_id = p_provider;
  if v_secret is null then
    return null;
  end if;
  return pgp_sym_decrypt(v_secret, p_key);
end $$;

-- Wrapper public pour l'écriture, réservé au service_role (le serveur applique
-- lui-même le contrôle de rôle admin avant d'appeler). PAS de wrapper de lecture :
-- le secret déchiffré ne transite jamais par PostgREST.
create or replace function public.set_provider_credential(
  p_org uuid, p_provider text, p_secret text, p_key text, p_config jsonb default '{}'
) returns text
language sql security definer set search_path = public, app as $$
  select app.set_credential(p_org, p_provider, p_secret, p_key, p_config);
$$;
revoke all on function public.set_provider_credential(uuid, text, text, text, jsonb) from public;
grant execute on function public.set_provider_credential(uuid, text, text, text, jsonb) to service_role;

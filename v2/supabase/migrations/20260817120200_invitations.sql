-- ============================================================================
-- T3 — Invitations. Un admin invite une adresse email avec un rôle ;
-- l'invité accepte via un jeton, ce qui crée son adhésion.
-- ============================================================================

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role membership_role not null default 'viewer',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  unique (organization_id, email)
);

alter table invitations enable row level security;
alter table invitations force row level security;

-- Gestion des invitations : admin+ de l'organisation.
create policy invitations_read on public.invitations for select to authenticated
  using (organization_id in (select app.user_orgs('admin')));
create policy invitations_write on public.invitations for all to authenticated
  using (organization_id in (select app.user_orgs('admin')))
  with check (organization_id in (select app.user_orgs('admin')));

-- Acceptation : l'invité (dont l'email correspond) échange un jeton contre une adhésion.
create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_inv invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'authentification requise';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_inv from invitations where token = p_token;
  if not found then
    raise exception 'invitation introuvable';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation déjà utilisée';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expirée';
  end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'cette invitation ne correspond pas à votre adresse';
  end if;

  insert into memberships (organization_id, user_id, role)
    values (v_inv.organization_id, auth.uid(), v_inv.role)
    on conflict (organization_id, user_id) do update set role = excluded.role;

  update invitations set accepted_at = now() where id = v_inv.id;

  return v_inv.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wrappers publics : PostgREST n'expose que le schéma `public`. On ré-expose
-- les RPC appelables par l'app (les helpers internes restent dans `app`).
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text, p_locale text default 'fr')
returns uuid language sql security definer set search_path = public, app as $$
  select app.create_organization(p_name, p_slug, p_locale);
$$;
grant execute on function public.create_organization(text, text, text) to authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid language sql security definer set search_path = public, app as $$
  select app.accept_invitation(p_token);
$$;
grant execute on function public.accept_invitation(text) to authenticated;

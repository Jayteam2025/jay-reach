-- ============================================================================
-- T9b — Import des clients actuels. Exclusion au niveau du COMPTE (jamais du
-- seul contact) : SIREN → domaine → nom normalisé. Motif affiché en clair.
-- Retrait d'une liste = retrait des suppressions d'origine `customer_import`.
-- ============================================================================

create table customer_list_entries (
  id uuid primary key default gen_random_uuid(),
  customer_list_id uuid not null references customer_lists(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  siren text,
  domain text,
  name_normalized text,
  raw_name text,
  created_at timestamptz not null default now()
);
create index customer_list_entries_org_idx on customer_list_entries (organization_id);
create index customer_list_entries_siren_idx on customer_list_entries (organization_id, siren) where siren is not null;
create index customer_list_entries_domain_idx on customer_list_entries (organization_id, domain) where domain is not null;
create index customer_list_entries_name_idx on customer_list_entries (organization_id, name_normalized) where name_normalized is not null;

alter table customer_list_entries enable row level security;
alter table customer_list_entries force row level security;
create policy customer_list_entries_read on public.customer_list_entries for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));
create policy customer_list_entries_write on public.customer_list_entries for all to authenticated
  using (organization_id in (select app.user_orgs('admin')))
  with check (organization_id in (select app.user_orgs('admin')));

-- Un compte correspond-il à un client (SIREN puis domaine puis nom normalisé) ?
create or replace function app.match_customer_account(
  p_org uuid, p_siren text, p_domain text, p_name_normalized text
) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from customer_list_entries e
    where e.organization_id = p_org
      and (
        (p_siren is not null and e.siren = p_siren)
        or (p_domain is not null and e.domain = p_domain)
        or (p_name_normalized is not null and e.name_normalized = p_name_normalized)
      )
  );
$$;

-- Dès qu'un compte est marqué client, une suppression de portée `account`
-- (origine `customer_import`) est créée. Motif en clair.
create or replace function app.enforce_customer_exclusion()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.is_customer is true then
    if not exists (
      select 1 from suppressions
      where organization_id = new.organization_id
        and scope = 'account' and value = new.id::text and origin = 'customer_import'
    ) then
      insert into suppressions (organization_id, scope, value, reason, origin)
        values (new.organization_id, 'account', new.id::text,
                'Compte présent dans votre liste clients', 'customer_import');
    end if;
  end if;
  return new;
end $$;

create trigger accounts_customer_exclusion
  after insert or update of is_customer on accounts
  for each row execute function app.enforce_customer_exclusion();

-- Retrait d'une liste clients : retire uniquement les suppressions issues de
-- cet import (origine customer_import), jamais les désinscriptions réelles.
create or replace function app.remove_customer_suppressions(p_org uuid)
returns integer
language plpgsql security definer set search_path = public, app as $$
declare v_count integer;
begin
  with deleted as (
    delete from suppressions
    where organization_id = p_org and origin = 'customer_import'
    returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end $$;

-- ============================================================================
-- T8 — Résolution d'entreprise : passe trigram + statut d'arbitrage + filtre
-- (non désactivable) d'opposition légale au démarchage.
-- ============================================================================

-- Statut de résolution du compte ('unresolved' => file d'arbitrage humain).
alter table accounts add column if not exists resolution_status signal_resolution not null default 'resolved';
create index if not exists accounts_unresolved_idx on accounts (organization_id)
  where resolution_status = 'unresolved';

-- Passe 3 — correspondance floue (pg_trgm) sur les comptes d'une organisation.
create or replace function public.search_accounts_trgm(p_org uuid, p_name text)
returns table (account_id uuid, name text, similarity real)
language sql stable security definer set search_path = public, app as $$
  select a.id, a.name, similarity(a.name, p_name) as similarity
  from accounts a
  where a.organization_id = p_org
    and a.name % p_name
  order by similarity desc
  limit 5;
$$;
grant execute on function public.search_accounts_trgm(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Opposition légale au démarchage. Dès que l'indicateur passe à true, une
-- suppression de portée `account` (origine `sirene_opposition`) est créée
-- automatiquement. Filtre NON désactivable : c'est un trigger en base.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_prospecting_opposition()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.prospecting_opposition is true then
    if not exists (
      select 1 from suppressions
      where organization_id = new.organization_id
        and scope = 'account' and value = new.id::text and origin = 'sirene_opposition'
    ) then
      insert into suppressions (organization_id, scope, value, reason, origin)
        values (new.organization_id, 'account', new.id::text,
                'Opposition légale au démarchage (annuaire des entreprises)', 'sirene_opposition');
    end if;
  end if;
  return new;
end $$;

create trigger accounts_prospecting_opposition
  after insert or update of prospecting_opposition on accounts
  for each row execute function app.enforce_prospecting_opposition();

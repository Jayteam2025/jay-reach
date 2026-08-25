-- ============================================================================
-- Test de la résolution d'entreprise (T8) : passe trigram + filtre opposition.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('88888888-8888-8888-8888-888888888888', 'resolve@test.local')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', '88888888-8888-8888-8888-888888888888', false);
select app.create_organization('Org Resolve', 'org-resolve') as orgr \gset
select set_config('test.orgr', :'orgr', false);

set role service_role;
insert into public.accounts (organization_id, name) values
  (:'orgr', 'Boulangerie Muller'),
  (:'orgr', 'Vantel France');

-- Passe 3 : une faute de frappe retrouve quand même le compte (trigram).
do $$
begin
  if not exists (
    select 1 from public.search_accounts_trgm(current_setting('test.orgr')::uuid, 'Boulangerie Mueller')
  ) then
    raise exception 'FAIL trigram : aucune correspondance floue';
  end if;
  raise notice 'OK trigram (faute de frappe rapprochée du bon compte)';
end $$;

-- Opposition : activer l'indicateur crée une suppression account/sirene_opposition.
update public.accounts set prospecting_opposition = true
  where organization_id = current_setting('test.orgr')::uuid and name = 'Vantel France';
do $$
declare v_acc uuid;
begin
  select id into v_acc from public.accounts
    where organization_id = current_setting('test.orgr')::uuid and name = 'Vantel France';
  if not exists (
    select 1 from public.suppressions
    where organization_id = current_setting('test.orgr')::uuid
      and scope = 'account' and value = v_acc::text and origin = 'sirene_opposition'
  ) then
    raise exception 'FAIL opposition : suppression non créée par le trigger';
  end if;
  raise notice 'OK opposition (suppression account/sirene_opposition créée automatiquement)';
end $$;

reset role;
select '=== COMPANY RESOLUTION OK ===' as result;

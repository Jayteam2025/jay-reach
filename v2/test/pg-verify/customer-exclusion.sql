-- ============================================================================
-- Test de l'exclusion des clients actuels (T9b).
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('99999999-9999-9999-9999-999999999999', 'cust@test.local')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', '99999999-9999-9999-9999-999999999999', false);
select app.create_organization('Org Cust', 'org-cust') as orgc \gset
select set_config('test.orgc', :'orgc', false);

set role service_role;
insert into public.customer_lists (id, organization_id, name, source)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', :'orgc', 'Clients', 'csv');
insert into public.customer_list_entries (customer_list_id, organization_id, siren, raw_name)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', :'orgc', '111222333', 'Groupe Vantel');
insert into public.accounts (organization_id, name, siren)
  values (:'orgc', 'Vantel', '111222333');

-- Correspondance par SIREN.
do $$
begin
  if not app.match_customer_account(current_setting('test.orgc')::uuid, '111222333', null, null) then
    raise exception 'FAIL match : SIREN client non reconnu';
  end if;
  raise notice 'OK match (compte reconnu comme client par SIREN)';
end $$;

-- Marquer client => suppression au niveau du COMPTE, motif en clair.
update public.accounts set is_customer = true
  where organization_id = current_setting('test.orgc')::uuid and siren = '111222333';
do $$
declare v_acc uuid;
begin
  select id into v_acc from public.accounts
    where organization_id = current_setting('test.orgc')::uuid and siren = '111222333';
  if not exists (
    select 1 from public.suppressions
    where organization_id = current_setting('test.orgc')::uuid
      and scope = 'account' and value = v_acc::text and origin = 'customer_import'
  ) then
    raise exception 'FAIL exclusion : suppression client non créée';
  end if;
  raise notice 'OK exclusion (suppression account/customer_import créée)';
end $$;

-- Une vraie désinscription coexiste ; retirer la liste clients ne doit PAS la toucher.
insert into public.suppressions (organization_id, scope, value, origin)
  values (:'orgc', 'email', 'real@unsub.test', 'unsubscribe');
select app.remove_customer_suppressions(:'orgc') as removed \gset
do $$
begin
  if exists (
    select 1 from public.suppressions
    where organization_id = current_setting('test.orgc')::uuid and origin = 'customer_import'
  ) then
    raise exception 'FAIL retrait : suppression customer_import restante';
  end if;
  if not exists (
    select 1 from public.suppressions
    where organization_id = current_setting('test.orgc')::uuid and origin = 'unsubscribe'
  ) then
    raise exception 'FAIL retrait : la désinscription réelle a été supprimée !';
  end if;
  raise notice 'OK retrait (customer_import retiré, désinscription réelle préservée)';
end $$;

reset role;
select '=== CUSTOMER EXCLUSION OK ===' as result;

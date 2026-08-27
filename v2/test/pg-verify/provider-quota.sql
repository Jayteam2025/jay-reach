-- ============================================================================
-- Plafond quotidien par provider. Reoon plafonne l'offre gratuite à vingt
-- vérifications par jour : sans ce garde-fou, on envoie des appels qui
-- reviendront en erreur, et on ne sait pas pourquoi les emails ne sont plus
-- vérifiés. La consommation doit être atomique — deux workers ne peuvent pas
-- obtenir le dernier crédit tous les deux.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'cap@test.local')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', 'bbbbbbbb-0000-4000-8000-000000000001', false);
select app.create_organization('Org Cap', 'org-cap') as orgc \gset
reset role;
select set_config('test.orgc', :'orgc', false);

do $$
declare v_org uuid := current_setting('test.orgc')::uuid; ok boolean; n int;
begin
  -- ASSERT 1 : le plafond est respecté à l'unité près.
  for i in 1..3 loop
    ok := app.consume_provider_credit(v_org, 'reoon', 3, 1);
    if not ok then raise exception 'FAIL quota-accord : crédit % refusé sous un plafond de 3', i; end if;
  end loop;
  ok := app.consume_provider_credit(v_org, 'reoon', 3, 1);
  if ok then raise exception 'FAIL quota-plafond : 4e crédit accordé malgré le plafond de 3'; end if;
  raise notice 'OK quota-plafond (3 accordés, 4e refusé)';

  -- ASSERT 2 : le compteur reflète exactement ce qui a été accordé — un refus ne
  -- doit pas incrémenter, sinon le quota se consomme tout seul.
  select used into n from public.provider_daily_usage
    where organization_id = v_org and provider_id = 'reoon' and usage_date = current_date;
  if n <> 3 then raise exception 'FAIL quota-compteur : % au lieu de 3', n; end if;
  raise notice 'OK quota-compteur (aucun refus compté)';

  -- ASSERT 3 : relever le plafond débloque à chaud, sans migration.
  ok := app.consume_provider_credit(v_org, 'reoon', 10, 1);
  if not ok then raise exception 'FAIL quota-relevable : plafond relevé mais crédit refusé'; end if;
  raise notice 'OK quota-relevable (plafond ajusté depuis la configuration)';

  -- ASSERT 4 : chaque provider a son compteur.
  ok := app.consume_provider_credit(v_org, 'bouncer', 1, 1);
  if not ok then raise exception 'FAIL quota-isolation : bouncer suit le compteur de reoon'; end if;
  raise notice 'OK quota-isolation (un compteur par provider)';

  -- ASSERT 5 : une demande plus grosse que le reste disponible est refusée en
  -- bloc, elle ne consomme pas partiellement le quota.
  ok := app.consume_provider_credit(v_org, 'bouncer', 1, 5);
  if ok then raise exception 'FAIL quota-atomique : une demande au-delà du reste a été accordée'; end if;
  select used into n from public.provider_daily_usage
    where organization_id = v_org and provider_id = 'bouncer' and usage_date = current_date;
  if n <> 1 then raise exception 'FAIL quota-atomique : compteur bouncer à % après un refus', n; end if;
  raise notice 'OK quota-atomique (tout ou rien)';
end $$;

-- ASSERT 6 : le compteur d'une organisation n'est pas celui d'une autre.
set role authenticated;
select set_config('test.user_id', 'bbbbbbbb-0000-4000-8000-000000000001', false);
select app.create_organization('Org Cap 2', 'org-cap-2') as orgc2 \gset
reset role;
do $$
declare ok boolean;
begin
  -- L'organisation précédente a épuisé son plafond de 1 sur bouncer ; celle-ci
  -- doit repartir de zéro.
  ok := app.consume_provider_credit(
    (select id from public.organizations where slug='org-cap-2'), 'bouncer', 1, 1);
  if not ok then raise exception 'FAIL quota-tenant : le quota est partagé entre organisations'; end if;
  raise notice 'OK quota-tenant (un compteur par organisation)';
end $$;

select '=== PROVIDER QUOTA OK ===' as result;

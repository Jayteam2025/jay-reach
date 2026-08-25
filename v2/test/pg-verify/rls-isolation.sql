-- ============================================================================
-- Test d'isolation inter-organisations (T2).
-- Deux utilisateurs, deux organisations : chacun est aveugle aux données de l'autre.
-- Toute violation lève une exception -> psql -v ON_ERROR_STOP=1 sort en échec.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local')
on conflict do nothing;

-- ---- Utilisateur A crée son org + un contact -------------------------------
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select app.create_organization('Org A', 'org-a') as orga \gset
insert into contacts (organization_id, first_name, email)
  values (:'orga', 'Alice', 'alice@a.test');

-- ---- Utilisateur B crée son org --------------------------------------------
select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);
select app.create_organization('Org B', 'org-b') as orgb \gset

-- ---- ASSERT 1 : B ne voit AUCUN contact de A -------------------------------
do $$
begin
  if (select count(*) from public.contacts where email = 'alice@a.test') <> 0 then
    raise exception 'FAIL isolation-select : B voit un contact de A';
  end if;
  raise notice 'OK isolation-select';
end $$;

-- ---- ASSERT 2 : B ne peut PAS écrire dans l'org de A -----------------------
select set_config('test.orga', :'orga', false);
do $$
begin
  insert into public.contacts (organization_id, first_name, email)
    values (current_setting('test.orga')::uuid, 'Mallory', 'mallory@b.test');
  raise exception 'FAIL isolation-insert : B a inséré dans l''org de A';
exception
  when insufficient_privilege then
    raise notice 'OK isolation-insert (RLS a bloqué l''écriture cross-org)';
end $$;

-- ---- ASSERT 3 : A voit bien SON contact ------------------------------------
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
do $$
begin
  if (select count(*) from public.contacts where email = 'alice@a.test') <> 1 then
    raise exception 'FAIL : A ne voit pas son propre contact';
  end if;
  raise notice 'OK acces-proprietaire';
end $$;

reset role;
select '=== RLS ISOLATION OK ===' as result;

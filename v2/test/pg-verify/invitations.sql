-- ============================================================================
-- Test du flux d'invitation (T3).
--  1. un admin invite un email avec un rôle,
--  2. l'invité (bon email) accepte -> adhésion créée avec le bon rôle,
--  3. un tiers (mauvais email) ne peut pas accepter.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('33333333-3333-3333-3333-333333333333', 'admin@org.test'),
  ('44444444-4444-4444-4444-444444444444', 'invitee@org.test'),
  ('55555555-5555-5555-5555-555555555555', 'stranger@org.test')
on conflict do nothing;

-- Admin crée l'org et invite un opérateur.
set role authenticated;
select set_config('test.user_id', '33333333-3333-3333-3333-333333333333', false);
select app.create_organization('Org Invite', 'org-invite') as orgi \gset
select set_config('test.orgi', :'orgi', false);
insert into public.invitations (organization_id, email, role, invited_by)
  values (:'orgi', 'invitee@org.test', 'operator', '33333333-3333-3333-3333-333333333333')
  returning token as tok \gset

-- L'invité accepte.
select set_config('test.user_id', '44444444-4444-4444-4444-444444444444', false);
select app.accept_invitation(:'tok');

do $$
begin
  if not exists (
    select 1 from public.memberships
    where organization_id = current_setting('test.orgi')::uuid
      and user_id = '44444444-4444-4444-4444-444444444444'
      and role = 'operator'
  ) then
    raise exception 'FAIL invite-accept : adhésion operator non créée';
  end if;
  raise notice 'OK invite-accept';
end $$;

-- Un tiers avec le mauvais email ne peut pas accepter (2e invitation).
reset role;
insert into public.invitations (organization_id, email, role, invited_by)
  values (current_setting('test.orgi')::uuid, 'someone@org.test', 'viewer',
          '33333333-3333-3333-3333-333333333333')
  returning token as tok2 \gset
set role authenticated;
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);
select set_config('test.tok2', :'tok2', false);
do $$
begin
  perform app.accept_invitation(current_setting('test.tok2'));
  raise exception 'FAIL invite-wrong-email : acceptation par le mauvais email autorisée';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK invite-wrong-email (rejeté : %)', sqlerrm;
end $$;

reset role;
select '=== INVITATIONS OK ===' as result;

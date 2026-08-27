-- ============================================================================
-- Liaison contact ↔ expéditeur (T17, docs/04 « Attribution des expéditeurs »).
-- Le lien est à vie POUR UN CANAL. La base doit garantir trois choses que le
-- code seul ne peut pas tenir :
--   1. un contact peut avoir un expéditeur par canal (email ET LinkedIn),
--   2. il ne peut pas en avoir deux du même canal,
--   3. le type enregistré est forcément celui de l'expéditeur pointé.
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'bind@test.local')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select app.create_organization('Org Bind', 'org-bind') as orgb \gset
reset role;
select set_config('test.orgb', :'orgb', false);

insert into public.accounts (id, organization_id, name)
  values ('aaaaaaaa-0000-4000-8000-0000000000a1', :'orgb', 'Cie Bind');
insert into public.contacts (id, organization_id, account_id, first_name, last_name) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', :'orgb', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Bind', 'Un'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', :'orgb', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Bind', 'Deux');
insert into public.senders (id, organization_id, kind, identity) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', :'orgb', 'email',    'a@test.local'),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', :'orgb', 'email',    'b@test.local'),
  ('aaaaaaaa-0000-4000-8000-0000000000f1', :'orgb', 'linkedin', 'li-profil');

-- ASSERT 1 : un expéditeur par canal pour le même contact — accepté.
insert into public.contact_sender_bindings (contact_id, sender_id, sender_kind) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'email'),
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'linkedin');
do $$
begin
  if (select count(*) from public.contact_sender_bindings
      where contact_id = 'aaaaaaaa-0000-4000-8000-0000000000c1') <> 2 then
    raise exception 'FAIL bind-multicanal : les deux liens ne sont pas en base';
  end if;
  raise notice 'OK bind-multicanal (un expéditeur email ET un expéditeur LinkedIn)';
end $$;

-- ASSERT 2 : deux expéditeurs du même canal pour un contact — refusé.
-- L'ancienne clé primaire (contact_id, sender_id) l'autorisait, et la résolution
-- en prenait un au hasard.
do $$
begin
  insert into public.contact_sender_bindings (contact_id, sender_id, sender_kind)
    values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000e2', 'email');
  raise exception 'FAIL bind-unicite : un deuxième expéditeur email a été accepté';
exception when unique_violation then
  raise notice 'OK bind-unicite (un seul expéditeur email par contact)';
end $$;

-- ASSERT 3 : un type qui n'est pas celui de l'expéditeur pointé — refusé par la
-- clé étrangère composite vers senders(id, kind). Contact distinct, sinon c'est
-- la clé primaire qui refuserait en premier et l'assertion ne prouverait rien.
do $$
begin
  insert into public.contact_sender_bindings (contact_id, sender_id, sender_kind)
    values ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-0000000000e2', 'linkedin');
  raise exception 'FAIL bind-coherence : un type incohérent avec l''expéditeur a été accepté';
exception when foreign_key_violation then
  raise notice 'OK bind-coherence (le type est celui de l''expéditeur pointé)';
end $$;

select '=== SENDER BINDING OK ===' as result;

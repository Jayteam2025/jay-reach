-- ============================================================================
-- Test du coffre à credentials (T5).
--  1. le serveur chiffre un secret (pgcrypto),
--  2. la bonne clé le déchiffre, la mauvaise échoue,
--  3. un membre non-admin ne voit jamais le secret (seulement la vue publique).
-- ============================================================================
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('66666666-6666-6666-6666-666666666666', 'admin@vault.test'),
  ('77777777-7777-7777-7777-777777777777', 'viewer@vault.test')
on conflict do nothing;

-- Admin crée l'org, on ajoute un viewer.
set role authenticated;
select set_config('test.user_id', '66666666-6666-6666-6666-666666666666', false);
select app.create_organization('Org Vault', 'org-vault') as orgv \gset
reset role;
insert into public.memberships (organization_id, user_id, role)
  values (:'orgv', '77777777-7777-7777-7777-777777777777', 'viewer')
on conflict do nothing;

-- Le serveur (service_role) enregistre un secret chiffré.
set role service_role;
select set_config('test.orgv', :'orgv', false);
select app.set_credential(:'orgv', 'smartlead', 'sk-secret-ABCD', 'clef-chiffrement-32-octets-xxxxx', '{"note":"demo"}') as last4 \gset

-- ASSERT 1 : la bonne clé déchiffre.
do $$
begin
  if app.get_credential(current_setting('test.orgv')::uuid, 'smartlead', 'clef-chiffrement-32-octets-xxxxx')
     <> 'sk-secret-ABCD' then
    raise exception 'FAIL vault-decrypt : mauvais déchiffrement';
  end if;
  raise notice 'OK vault-decrypt';
end $$;

-- ASSERT 2 : le last4 exposé est correct, le secret stocké est bien chiffré.
do $$
begin
  if (select last4 from public.credentials
      where organization_id = current_setting('test.orgv')::uuid and provider_id='smartlead') <> 'ABCD' then
    raise exception 'FAIL vault-last4';
  end if;
  if (select position('sk-secret-ABCD'::bytea in secret) <> 0 from public.credentials
      where organization_id = current_setting('test.orgv')::uuid and provider_id='smartlead') then
    raise exception 'FAIL vault-plaintext : le secret est stocké en clair !';
  end if;
  raise notice 'OK vault-encrypted-at-rest';
end $$;

-- ASSERT 3 : la mauvaise clé échoue.
do $$
begin
  perform app.get_credential(current_setting('test.orgv')::uuid, 'smartlead', 'mauvaise-clef');
  raise exception 'FAIL vault-wrong-key : déchiffrement avec mauvaise clé accepté';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK vault-wrong-key (rejeté)';
end $$;

-- ASSERT 4 : un membre viewer ne peut PAS lire le secret (RLS admin-only)…
set role authenticated;
select set_config('test.user_id', '77777777-7777-7777-7777-777777777777', false);
do $$
begin
  if (select count(*) from public.credentials
      where organization_id = current_setting('test.orgv')::uuid) <> 0 then
    raise exception 'FAIL vault-rls : un viewer lit la table des secrets';
  end if;
  raise notice 'OK vault-rls (viewer ne voit pas la table des secrets)';
end $$;

-- …mais voit la vue publique (statut + last4, sans secret).
do $$
begin
  if (select last4 from public.credentials_public
      where organization_id = current_setting('test.orgv')::uuid and provider_id='smartlead') <> 'ABCD' then
    raise exception 'FAIL vault-view : le viewer ne voit pas la vue publique';
  end if;
  raise notice 'OK vault-public-view (viewer voit last4/statut, jamais le secret)';
end $$;

reset role;
select '=== CREDENTIALS VAULT OK ===' as result;

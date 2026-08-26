-- ============================================================================
-- Fix coffre à credentials : sur Supabase hébergé, l'extension `pgcrypto` vit
-- dans le schéma `extensions`, pas `public`. Les fonctions du coffre étaient
-- déclarées `set search_path = public, app` → `pgp_sym_encrypt`/`pgp_sym_decrypt`
-- introuvables → « function pgp_sym_encrypt(text, text) does not exist » à
-- l'enregistrement de TOUTE clé provider (écran Fournisseurs). En local le bug
-- ne se voyait pas (pgcrypto dans `public`). On ajoute `extensions` au
-- search_path des deux fonctions. Idempotent, sans effet là où pgcrypto est
-- déjà dans `public`.
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

alter function app.set_credential(uuid, text, text, text, jsonb)
  set search_path = public, app, extensions;
alter function app.get_credential(uuid, text, text)
  set search_path = public, app, extensions;

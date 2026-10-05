#!/usr/bin/env bash
# G7 : vérifie sur un vrai Postgres que `manquesPourLancer` (campagnes.ts) lit
# le statut SalesBlink sur une relation visible par le pool de service (`ctx.ex`,
# une connexion `pg` brute, sans session Supabase Auth) — pas sur
# `credentials_public`, qui filtre par `app.user_orgs()` (donc `auth.uid()`,
# NULL hors PostgREST) et renvoie silencieusement 0 ligne dans ce cas.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_manques_cle
PORT=55433

echo "[manques] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[manques] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[manques] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[manques] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

# `postgres:16-alpine` est nu : sur Supabase (hébergé comme self-hosted), le
# schéma `extensions` existe déjà et `pgcrypto` y est préinstallé AVANT nos
# migrations. Sans ce préalable, `20260828140000_extension_token_hash.sql`
# (qui appelle `extensions.digest(...)`) échoue. Même préalable que la
# plateforme, posé une fois ici plutôt que dans `auth-shim.sql` (partagé par
# tous les harnais, hors périmètre de ce ticket).
psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
  || { echo "[manques] EXTENSIONS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 5; }

echo "[manques] shim auth + migrations…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[manques] SHIM_FAIL"; exit 6; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[manques] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 7; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[manques] GRANTS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 8; }

echo "[manques] jeu d'essai (deux organisations : avec et sans clé SalesBlink)…"
psql >/dev/null <<'SQL' || { echo "[manques] SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }
reset role;
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-avec-cle@g7.test'),
  ('99999999-9999-9999-9999-999999999999', 'owner-sans-cle@g7.test');

set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select app.create_organization('Org G7 avec cle', 'org-g7-avec-cle');
select set_config('test.user_id', '99999999-9999-9999-9999-999999999999', false);
select app.create_organization('Org G7 sans cle', 'org-g7-sans-cle');
reset role;
SQL

ORG_AVEC_CLE=$(psql -tAc "select id from public.organizations where slug='org-g7-avec-cle'" | tr -d '[:space:]')
ORG_SANS_CLE=$(psql -tAc "select id from public.organizations where slug='org-g7-sans-cle'" | tr -d '[:space:]')
[ -n "$ORG_AVEC_CLE" ] && [ -n "$ORG_SANS_CLE" ] || { echo "[manques] ORG_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }

psql >/dev/null <<SQL || { echo "[manques] SEED2_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 10; }
reset role;
-- Statut écrit comme le ferait le serveur (service_role, table directe) :
-- une ligne 'configured' pour salesblink, uniquement pour la première org.
insert into public.credentials (organization_id, provider_id, secret, config, status, last4)
values ('$ORG_AVEC_CLE', 'salesblink', null, '{}', 'configured', '9999');

-- Séquence + expéditeur email actif dans les deux organisations, pour que la
-- branche email de manquesPourLancer s'exécute jusqu'au bout (sinon le manque
-- « aucun expéditeur » masquerait le manque testé).
insert into public.sources (id, organization_id, provider_id, name, is_active) values
  ('66666666-6666-6666-6666-666666666666', '$ORG_AVEC_CLE', 'adzuna', 'Source avec cle', true),
  ('a6666666-6666-6666-6666-666666666666', '$ORG_SANS_CLE', 'adzuna', 'Source sans cle', true);

insert into public.campaigns (id, organization_id, name, status, source_id, entry_rules) values
  ('22222222-2222-2222-2222-222222222222', '$ORG_AVEC_CLE', 'Campagne avec cle', 'draft', '66666666-6666-6666-6666-666666666666', '{}'),
  ('a2222222-2222-2222-2222-222222222222', '$ORG_SANS_CLE', 'Campagne sans cle', 'draft', 'a6666666-6666-6666-6666-666666666666', '{}');

insert into public.message_templates (id, organization_id, name, channel, locale, version, subject, body, is_active) values
  ('33333333-3333-3333-3333-333333333333', '$ORG_AVEC_CLE', 'Modele', 'email', 'fr', 1, 'Sujet', 'Corps', true),
  ('a3333333-3333-3333-3333-333333333333', '$ORG_SANS_CLE', 'Modele', 'email', 'fr', 1, 'Sujet', 'Corps', true);

insert into public.sequence_steps (id, campaign_id, position, channel, template_parent_id, delay_hours) values
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 0, 'email', '33333333-3333-3333-3333-333333333333', 0),
  ('a4444444-4444-4444-4444-444444444444', 'a2222222-2222-2222-2222-222222222222', 0, 'email', 'a3333333-3333-3333-3333-333333333333', 0);

insert into public.senders (id, organization_id, kind, is_active, provider_ref, provider_state, identity, display_name) values
  ('55555555-5555-5555-5555-555555555555', '$ORG_AVEC_CLE', 'email', true, 'sender-ref-1', '{"sending_enabled":true}', 'expediteur1@test.fr', 'Expediteur 1'),
  ('a5555555-5555-5555-5555-555555555555', '$ORG_SANS_CLE', 'email', true, 'sender-ref-2', '{"sending_enabled":true}', 'expediteur2@test.fr', 'Expediteur 2');
SQL

echo "[manques] bundle de campagnes.ts (esbuild)…"
# On exécute depuis apps/worker : `pg` et `zod` y sont résolvables (pnpm ne
# les hisse pas à la racine). Même technique que credentials-bridge.sh.
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/packages/core/src/fonctions/campagnes.ts" \
  --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_manques-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[manques] BUNDLE_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
cp "$DIR/test/pg-verify/manques-cle-transport.mjs" "$DIR/apps/worker/_manques-runner.mjs"

echo "[manques] exécution du test node…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  TEST_ORG_AVEC_CLE="$ORG_AVEC_CLE" TEST_CAMPAGNE_AVEC_CLE="22222222-2222-2222-2222-222222222222" \
  TEST_ORG_SANS_CLE="$ORG_SANS_CLE" TEST_CAMPAGNE_SANS_CLE="a2222222-2222-2222-2222-222222222222" \
  node "$DIR/apps/worker/_manques-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_manques-bundle.mjs" "$DIR/apps/worker/_manques-runner.mjs"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[manques] VERIFY_OK" || echo "[manques] VERIFY_FAIL"
exit "$RC"

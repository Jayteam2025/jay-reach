#!/usr/bin/env bash
# Lot 2, P4 : la population globale des contacts (onglet Contacts, export CSV) est calculée par
# UNE requête Postgres (dédoublonnage par contact, tri, total, page). Ce harnais exécute cette
# requête pour de vrai sur un Postgres jetable, sur un jeu d'essai à égalités d'instant et à
# contacts multi-campagnes, et la compare à l'ancienne boucle en mémoire (oracle). Zéro envoi.
#
# Variante sur une base existante, en LECTURE SEULE (la session refuse toute écriture) :
#   MODE=lecture DATABASE_URL=... TEST_ORG=<uuid> BUNDLE=... node contacts-globaux.mjs
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_contacts_globaux
PORT=55434

echo "[contacts-globaux] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[contacts-globaux] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[contacts-globaux] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[contacts-globaux] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

# `postgres:16-alpine` est nu : sur Supabase (hébergé comme self-hosted), le
# schéma `extensions` existe déjà et `pgcrypto` y est préinstallé AVANT nos
# migrations. Sans ce préalable, `20260828140000_extension_token_hash.sql`
# (qui appelle `extensions.digest(...)`) échoue. Même préalable que la
# plateforme, posé une fois ici plutôt que dans `auth-shim.sql` (partagé par
# tous les harnais, hors périmètre de ce ticket).
psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
  || { echo "[contacts-globaux] EXTENSIONS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 5; }

# Le shim partagé ne crée pas `anon` (la migration 20260909120000 le révoque) : posé ici, sans toucher au shim.
psql -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end \$\$;" >/dev/null || { echo "[contacts-globaux] ROLE_FAIL"; exit 5; }

echo "[contacts-globaux] shim auth + migrations…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[contacts-globaux] SHIM_FAIL"; exit 6; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[contacts-globaux] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 7; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[contacts-globaux] GRANTS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 8; }

echo "[contacts-globaux] jeu d'essai…"
psql >/dev/null < "$DIR/test/pg-verify/contacts-globaux.sql" || { echo "[contacts-globaux] SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }

echo "[contacts-globaux] bundle (esbuild)…"
# Exécuté depuis apps/worker : `pg` et `zod` y sont résolvables (pnpm ne les hisse pas à la racine).
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/test/pg-verify/contacts-globaux-entree.ts" \
  --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_cg-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[contacts-globaux] BUNDLE_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
cp "$DIR/test/pg-verify/contacts-globaux.mjs" "$DIR/apps/worker/_cg-runner.mjs"

echo "[contacts-globaux] comparaison ancien / nouveau…"
(cd "$DIR/apps/worker" && DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  TEST_ORG="aaaaaaaa-0000-0000-0000-000000000001" BUNDLE="./_cg-bundle.mjs" node ./_cg-runner.mjs)
RC=$?

rm -f "$DIR/apps/worker/_cg-bundle.mjs" "$DIR/apps/worker/_cg-runner.mjs"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[contacts-globaux] VERIFY_OK" || echo "[contacts-globaux] VERIFY_FAIL"
exit "$RC"

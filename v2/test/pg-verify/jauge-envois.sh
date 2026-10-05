#!/usr/bin/env bash
# Lot 2, revue de cohérence : preuve, sur un vrai Postgres 16, que la jauge
# d'envois du menu dit la même chose que le moteur — un plafond non réglé n'est
# pas une pause, une action LinkedIn ne consomme pas le quota email, et la file
# du jour emploie la même définition du plafond que le menu.
# Le SQL de production est exécuté tel quel : le test ne contient aucune copie
# de ses requêtes. Voir jauge-envois.mjs pour les assertions.
#
# Usage : bash test/pg-verify/jauge-envois.sh        (conteneur jetable)
#         KEEP=1 bash test/pg-verify/jauge-envois.sh (garde le conteneur et la base chargée)
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_jauge
PORT=55442

echo "[jauge] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[jauge] DAEMON_FAIL"; exit 3; }

if ! "$DOCKER" ps --format '{{.Names}}' | grep -q "^$CT$"; then
  "$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
  "$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
    -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[jauge] RUN_FAIL"; exit 4; }
  ok=0
  for i in $(seq 1 90); do
    if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [ "$ok" -ge 2 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 2 ] || { echo "[jauge] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

  psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
  # Même préalable que la plateforme Supabase (cf. manques-cle-transport.sh) :
  # pgcrypto vit dans `extensions` AVANT les migrations ; le shim ne pose que le schéma.
  psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
    || { echo "[jauge] EXTENSIONS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 5; }
  echo "[jauge] shim auth + migrations…"
  psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[jauge] SHIM_FAIL"; exit 6; }
  for m in "$DIR"/supabase/migrations/*.sql; do
    psql < "$m" >/dev/null || { echo "[jauge] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 7; }
  done
  psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[jauge] GRANTS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 8; }
fi

echo "[jauge] bundles (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/test/pg-verify/jauge-envois-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" \
  --outfile="$DIR/apps/worker/_jauge-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[jauge] BUNDLE_FAIL"; exit 11; }
cp "$DIR/test/pg-verify/jauge-envois.mjs" "$DIR/apps/worker/_jauge-runner.mjs"

echo "[jauge] exécution…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  node "$DIR/apps/worker/_jauge-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_jauge-bundle.mjs" "$DIR/apps/worker/_jauge-runner.mjs"
[ -n "${KEEP:-}" ] || "$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[jauge] VERIFY_OK" || echo "[jauge] VERIFY_FAIL"
exit "$RC"

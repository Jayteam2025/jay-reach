#!/usr/bin/env bash
# Vérif hermétique du routage LinkedIn du dispatch worker (T22, Phase 4) contre
# la base locale (jr_dev). Bundle le handler de dispatch puis vérifie qu'un job
# de canal LinkedIn enfile l'action (sans aucun envoi). Données fictives.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[lkd] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[lkd] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[lkd] org introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[lkd] bundle du handler de dispatch (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/handlers/dispatch.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_lkd.mjs" >/dev/null 2>&1 || { echo "[lkd] BUNDLE_FAIL"; exit 5; }
cp "$DIR/test/pg-verify/linkedin-dispatch.mjs" "$DIR/apps/worker/_lkd-runner.mjs"

echo "[lkd] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_lkd-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_lkd.mjs" "$DIR/apps/worker/_lkd-runner.mjs"
exit "$RC"

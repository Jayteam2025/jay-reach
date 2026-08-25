#!/usr/bin/env bash
# Démo fictive de la chaîne moteur complète (sans clés d'API), contre la base
# locale de dev (jr_dev). Simule les providers, exécute le vrai code de
# persistance + chaînage du worker, puis affiche l'état de la base.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

# S'assure que la base locale tourne (la crée au besoin).
if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[demo] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[demo] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }

ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
SOURCE=$(psql -c "select id from public.sources where organization_id='$ORG' and provider_id='francetravail' limit 1" | tr -d '[:space:]')
[ -n "$ORG" ] && [ -n "$SOURCE" ] || { echo "[demo] org/source introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[demo] bundle des modules worker (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/db.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_demo-db.mjs" >/dev/null 2>&1 || { echo "[demo] BUNDLE_FAIL(db)"; exit 5; }
"$ESB" "$DIR/apps/worker/src/enrichment-persist.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_demo-persist.mjs" >/dev/null 2>&1 || { echo "[demo] BUNDLE_FAIL(persist)"; exit 5; }
cp "$DIR/test/pg-verify/demo-fictif.mjs" "$DIR/apps/worker/_demo-runner.mjs"

echo "[demo] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" TEST_SOURCE="$SOURCE" \
  node "$DIR/apps/worker/_demo-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_demo-db.mjs" "$DIR/apps/worker/_demo-persist.mjs" "$DIR/apps/worker/_demo-runner.mjs"
exit "$RC"

#!/usr/bin/env bash
# Vérif hermétique du traitement des webhooks Smartlead (T27) contre jr_dev.
# Aucune API. Bundle de la logique d'écriture (esbuild) + runner pg.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev; PORT=54329
if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[wh] DB_FAIL"; exit 3; }
fi
psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[wh] org démo introuvable"; exit 4; }

echo "[wh] bundle de la logique d'écriture (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/web/lib/webhooks/smartlead.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_wh.mjs" >/dev/null 2>&1 || { echo "[wh] BUNDLE_FAIL"; exit 5; }
cp "$DIR/test/pg-verify/smartlead-webhook.mjs" "$DIR/apps/worker/_wh-runner.mjs"

echo "[wh] exécution…"; echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_wh-runner.mjs"
RC=$?
rm -f "$DIR/apps/worker/_wh.mjs" "$DIR/apps/worker/_wh-runner.mjs"
exit "$RC"

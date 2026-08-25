#!/usr/bin/env bash
# Vérif hermétique de la chaîne séquenceur → file LinkedIn contre la base locale
# (jr_dev) : inscription → tick → action → dispatch → linkedin_action_queue.
# Données fictives, aucun envoi réel.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[seq] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[seq] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
SOURCE=$(psql -c "select id from public.sources where organization_id='$ORG' and provider_id='francetravail' limit 1" | tr -d '[:space:]')
[ -n "$ORG" ] && [ -n "$SOURCE" ] || { echo "[seq] org/source introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[seq] bundle des handlers (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/handlers/sequence.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_seq.mjs" >/dev/null 2>&1 || { echo "[seq] BUNDLE_FAIL(seq)"; exit 5; }
"$ESB" "$DIR/apps/worker/src/handlers/dispatch.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_lkd.mjs" >/dev/null 2>&1 || { echo "[seq] BUNDLE_FAIL(lkd)"; exit 5; }
cp "$DIR/test/pg-verify/sequence-tick.mjs" "$DIR/apps/worker/_seq-runner.mjs"

echo "[seq] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" TEST_SOURCE="$SOURCE" \
  node "$DIR/apps/worker/_seq-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_seq.mjs" "$DIR/apps/worker/_lkd.mjs" "$DIR/apps/worker/_seq-runner.mjs"
exit "$RC"

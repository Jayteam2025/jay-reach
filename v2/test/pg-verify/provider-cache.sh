#!/usr/bin/env bash
# Vérif du cache de providers contre la base locale (jr_dev) : hit/miss,
# cloisonnement par organisation, expiration, purge, tolérance à la panne.
# Aucun appel provider réel — on éprouve l'adaptateur, pas FullEnrich.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[cache] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[cache] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[cache] org introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[cache] bundle de l'adaptateur (esbuild)…"
# Le runner s'exécute depuis apps/worker : c'est le seul endroit d'où `pg` est
# résolvable (même procédé que les autres harnais).
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/provider-cache.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_cache.mjs" >/dev/null 2>&1 || { echo "[cache] BUNDLE_FAIL"; exit 5; }
cp "$DIR/test/pg-verify/provider-cache.mjs" "$DIR/apps/worker/_cache-runner.mjs"

echo "[cache] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_cache-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_cache.mjs" "$DIR/apps/worker/_cache-runner.mjs"
exit "$RC"

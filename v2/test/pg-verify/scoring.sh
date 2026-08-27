#!/usr/bin/env bash
# Vérif hermétique du scoring (T12) contre la base locale (jr_dev) : prompt + seuil
# PAR SOURCE (sources.config), pré-filtres, auto-apprentissage. Scorer déterministe
# injecté — aucun appel LLM, aucune donnée réelle.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[score] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[score] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[score] org démo introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[score] bundle du handler (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/handlers/score.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_score.mjs" >/dev/null 2>&1 || { echo "[score] BUNDLE_FAIL"; exit 5; }
cp "$DIR/test/pg-verify/scoring.mjs" "$DIR/apps/worker/_score-runner.mjs"

echo "[score] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_score-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_score.mjs" "$DIR/apps/worker/_score-runner.mjs"
exit "$RC"

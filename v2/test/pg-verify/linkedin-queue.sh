#!/usr/bin/env bash
# Vérif hermétique de la file d'actions LinkedIn (T22, Phase 1) contre la base
# locale (jr_dev). Bundle le module de file (apps/web/lib/linkedin/queue.ts) puis
# exécute le scénario de pacing sur des données fictives. Aucun envoi réel.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[lkq] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[lkq] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }

ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
USER=$(psql -c "select id from auth.users limit 1" | tr -d '[:space:]')
[ -n "$ORG" ] && [ -n "$USER" ] || { echo "[lkq] org/user introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[lkq] bundle du module de file (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
# On bundle + exécute depuis apps/web pour résoudre pg + @jay-reach/core (node_modules).
# pg reste externe (binaire natif) ; @jay-reach/core est bundlé + tree-shaké
# (seul le module pacing est retenu, pas les modules qui tirent zod).
"$ESB" "$DIR/apps/web/lib/linkedin/queue.ts" --bundle --platform=node --format=esm --external:pg \
  --outfile="$DIR/apps/web/_lkq.mjs" >/dev/null 2>&1 || { echo "[lkq] BUNDLE_FAIL"; exit 5; }
cp "$DIR/test/pg-verify/linkedin-queue.mjs" "$DIR/apps/web/_lkq-runner.mjs"

echo "[lkq] exécution…"
echo
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" TEST_USER="$USER" \
  node "$DIR/apps/web/_lkq-runner.mjs"
RC=$?

rm -f "$DIR/apps/web/_lkq.mjs" "$DIR/apps/web/_lkq-runner.mjs"
exit "$RC"

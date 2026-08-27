#!/usr/bin/env bash
# Vérif hermétique des RPC de versionnage des templates (T19) contre la base
# locale jr_dev. Aucun envoi, aucune UI.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev
PORT=54329

if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  echo "[tpl] base locale absente — lancement de scripts/dev-db.sh…"
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[tpl] DB_FAIL"; exit 3; }
fi

psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
USER=$(psql -c "select user_id from public.memberships m join public.organizations o on o.id=m.organization_id where o.slug='demo' order by app.role_rank(m.role) desc limit 1" | tr -d '[:space:]')
[ -n "$ORG" ] && [ -n "$USER" ] || { echo "[tpl] org/user introuvable (relancer scripts/dev-db.sh)"; exit 4; }

echo "[tpl] exécution…"
echo
# `pg` se résout depuis apps/worker/node_modules → on y copie le runner.
cp "$DIR/test/pg-verify/templates.mjs" "$DIR/apps/worker/_tpl-runner.mjs"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" TEST_USER="$USER" \
  node "$DIR/apps/worker/_tpl-runner.mjs"
RC=$?
rm -f "$DIR/apps/worker/_tpl-runner.mjs"
exit "$RC"

#!/usr/bin/env bash
# Vérif hermétique de l'éditeur de campagne (T24) contre jr_dev. Zéro envoi.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_dev; PORT=54329
if ! "$DOCKER" ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CT$"; then
  bash "$DIR/scripts/dev-db.sh" >/dev/null 2>&1 || { echo "[camp] DB_FAIL"; exit 3; }
fi
psql() { "$DOCKER" exec -i "$CT" psql -tA -U postgres -d jayreach "$@"; }
ORG=$(psql -c "select id from public.organizations where slug='demo'" | tr -d '[:space:]')
USER=$(psql -c "select user_id from public.memberships m join public.organizations o on o.id=m.organization_id where o.slug='demo' order by app.role_rank(m.role) desc limit 1" | tr -d '[:space:]')
[ -n "$ORG" ] && [ -n "$USER" ] || { echo "[camp] org/user introuvable"; exit 4; }
echo "[camp] exécution…"; echo
cp "$DIR/test/pg-verify/campaigns.mjs" "$DIR/apps/worker/_camp-runner.mjs"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" TEST_USER="$USER" \
  node "$DIR/apps/worker/_camp-runner.mjs"
RC=$?
rm -f "$DIR/apps/worker/_camp-runner.mjs"
exit "$RC"

#!/usr/bin/env bash
# Vérifie que l'écriture en base (résolution d'entreprise) fonctionne contre le
# nouveau schéma réel : applique les migrations puis exécute le test tsx.
set -uo pipefail
DOCKER=/usr/local/bin/docker
CT=jr_persist
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -p 55434:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach postgres:16-alpine >/dev/null || { echo RUN_FAIL; exit 4; }
ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ "$ok" -ge 2 ] && break; else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo PG_NOT_READY; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach; }
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "MIGRATION_FAIL $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 5; }
done

( cd "$DIR/apps/worker" && DATABASE_URL='postgres://postgres:postgres@localhost:55434/jayreach' pnpm exec tsx scripts/verify-persistence.ts )
code=$?

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
exit $code

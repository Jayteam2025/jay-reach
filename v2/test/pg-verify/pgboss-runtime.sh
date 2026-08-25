#!/usr/bin/env bash
# Vérifie le runtime pg-boss contre un vrai Postgres 16 (docker, port publié).
set -uo pipefail
DOCKER=/usr/local/bin/docker
CT=jr_pgboss_verify
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[pgboss] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[pgboss] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -p 55432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach postgres:16-alpine >/dev/null || { echo "[pgboss] RUN_FAIL"; exit 4; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[pgboss] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

echo "[pgboss] test d'intégration…"
( cd "$DIR/apps/worker" && DATABASE_URL='postgres://postgres:postgres@localhost:55432/jayreach' node scripts/verify-runtime.mjs )
code=$?

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
exit $code

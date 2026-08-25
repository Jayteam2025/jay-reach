#!/usr/bin/env bash
# Démarre le worker construit (moteur branché) contre un vrai Postgres et
# vérifie qu'il boot (déclare ses files) puis s'arrête proprement.
set -uo pipefail
DOCKER=/usr/local/bin/docker
CT=jr_worker_boot
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -p 55433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach postgres:16-alpine >/dev/null || { echo RUN_FAIL; exit 4; }
ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ "$ok" -ge 2 ] && break; else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo PG_NOT_READY; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

export DATABASE_URL='postgres://postgres:postgres@localhost:55433/jayreach'
node "$DIR/apps/worker/dist/index.js" >/tmp/jr-worker-boot.log 2>&1 &
PID=$!
booted=0
for i in $(seq 1 30); do
  if grep -q 'pg-boss démarré' /tmp/jr-worker-boot.log 2>/dev/null; then booted=1; break; fi
  sleep 1
done
kill "$PID" >/dev/null 2>&1
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true

if [ "$booted" -eq 1 ]; then
  echo "WORKER_BOOT_OK"
  grep 'démarré' /tmp/jr-worker-boot.log
else
  echo "WORKER_BOOT_FAIL"; tail -5 /tmp/jr-worker-boot.log
  exit 1
fi

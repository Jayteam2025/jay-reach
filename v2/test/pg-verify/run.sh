#!/usr/bin/env bash
# Vérifie le schéma T2 sur un vrai Postgres 16 (docker) avec un shim `auth`,
# puis exécute le test d'isolation inter-organisations.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_pg_verify

echo "[verify] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
if ! "$DOCKER" info >/dev/null 2>&1; then echo "[verify] DAEMON_FAIL (Docker ne démarre pas)"; exit 3; fi

echo "[verify] lancement de Postgres 16…"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach postgres:16-alpine >/dev/null || { echo "[verify] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

# Attente robuste : l'image Postgres redémarre une fois pendant l'init.
# On attend qu'une vraie requête passe, deux fois de suite.
ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else
    ok=0
  fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[verify] PG_NOT_READY"; "$DOCKER" logs "$CT" 2>&1 | tail -5; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

echo "[verify] shim auth…"; psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[verify] SHIM_FAIL"; exit 5; }
for m in "$DIR"/supabase/migrations/*.sql; do
  echo "[verify] migration $(basename "$m")…"
  psql < "$m" >/dev/null || { echo "[verify] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 6; }
done
echo "[verify] grants…"; psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[verify] GRANTS_FAIL"; exit 8; }
echo "[verify] test d'isolation…"; psql < "$DIR/test/pg-verify/rls-isolation.sql" || { echo "[verify] ISOLATION_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }
echo "[verify] test invitations…"; psql < "$DIR/test/pg-verify/invitations.sql" || { echo "[verify] INVITATIONS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 10; }
echo "[verify] test coffre credentials…"; psql < "$DIR/test/pg-verify/credentials.sql" || { echo "[verify] CREDENTIALS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
echo "[verify] test résolution d'entreprise…"; psql < "$DIR/test/pg-verify/company-resolution.sql" || { echo "[verify] RESOLUTION_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 12; }
echo "[verify] test exclusion clients…"; psql < "$DIR/test/pg-verify/customer-exclusion.sql" || { echo "[verify] CUSTOMER_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 13; }

echo "[verify] comptage des tables + policies…"
psql -c "select count(*) as tables from information_schema.tables where table_schema='public';"
psql -c "select count(*) as policies from pg_policies where schemaname='public';"

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
echo "[verify] VERIFY_OK"

#!/usr/bin/env bash
# Vérifie l'orchestration du worker (producteur + chaînage + source_runs) sur un
# vrai Postgres 16 (docker), de façon hermétique (aucune API externe).
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_orch_verify
PORT=55432

echo "[orch] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[orch] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[orch] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[orch] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

echo "[orch] shim auth + migrations…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[orch] SHIM_FAIL"; exit 5; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[orch] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 6; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[orch] GRANTS_FAIL"; exit 8; }

echo "[orch] org d'essai…"
psql >/dev/null <<'SQL' || { echo "[orch] ORG_SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }
reset role;
insert into auth.users(id, email) values ('99999999-9999-9999-9999-999999999999','orch@test') on conflict do nothing;
set role authenticated;
select set_config('test.user_id','99999999-9999-9999-9999-999999999999', false);
select app.create_organization('Org Orch','org-orch');
SQL
ORG=$(psql -tAc "select id from public.organizations where slug='org-orch'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[orch] ORG_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }

echo "[orch] bundle des modules worker (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/apps/worker/src/producer.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_orch-producer.mjs" >/dev/null 2>&1 || { echo "[orch] BUNDLE_FAIL(producer)"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
"$ESB" "$DIR/apps/worker/src/db.ts" --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_orch-db.mjs" >/dev/null 2>&1 || { echo "[orch] BUNDLE_FAIL(db)"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
cp "$DIR/test/pg-verify/orchestration.mjs" "$DIR/apps/worker/_orch-runner.mjs"

echo "[orch] exécution du test node…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_orch-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_orch-producer.mjs" "$DIR/apps/worker/_orch-db.mjs" "$DIR/apps/worker/_orch-runner.mjs"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[orch] VERIFY_OK" || echo "[orch] VERIFY_FAIL"
exit "$RC"

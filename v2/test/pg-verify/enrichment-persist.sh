#!/usr/bin/env bash
# Vérifie la persistance de l'enrichissement (accounts/contacts, nouveau schéma)
# sur un vrai Postgres 16 (docker), sans toucher l'API FullEnrich.
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_enrich_verify
PORT=55432

echo "[enrich] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[enrich] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[enrich] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[enrich] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

echo "[enrich] shim auth + migrations…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[enrich] SHIM_FAIL"; exit 5; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[enrich] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 6; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[enrich] GRANTS_FAIL"; exit 8; }

echo "[enrich] org d'essai…"
psql >/dev/null <<'SQL' || { echo "[enrich] ORG_SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }
reset role;
insert into auth.users(id, email) values ('55555555-5555-5555-5555-555555555555','enrich@test') on conflict do nothing;
set role authenticated;
select set_config('test.user_id','55555555-5555-5555-5555-555555555555', false);
select app.create_organization('Org Enrich','org-enrich');
SQL
ORG=$(psql -tAc "select id from public.organizations where slug='org-enrich'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[enrich] ORG_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }

echo "[enrich] bundle du module de persistance (esbuild)…"
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/apps/worker/src/enrichment-persist.ts" \
  --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_enrich-persist.mjs" >/dev/null 2>&1 \
  || { echo "[enrich] BUNDLE_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
cp "$DIR/test/pg-verify/enrichment-persist.mjs" "$DIR/apps/worker/_enrich-runner.mjs"

echo "[enrich] exécution du test node…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" TEST_ORG="$ORG" \
  node "$DIR/apps/worker/_enrich-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_enrich-persist.mjs" "$DIR/apps/worker/_enrich-runner.mjs"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[enrich] VERIFY_OK" || echo "[enrich] VERIFY_FAIL"
exit "$RC"

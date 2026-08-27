#!/usr/bin/env bash
# Vérifie le pont de résolution des credentials du worker (coffre + config +
# repli env) sur un vrai Postgres 16 (docker), port publié pour un client node.
set -uo pipefail
# Chemin résolu, pas figé : Docker Desktop installe dans /usr/local/bin, Colima
# et Homebrew dans /opt/homebrew/bin.
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_cred_bridge
PORT=55432
KEY=$(openssl rand -hex 32)

echo "[cred] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[cred] DAEMON_FAIL"; exit 3; }

"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[cred] RUN_FAIL"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[cred] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

echo "[cred] shim auth + migrations…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[cred] SHIM_FAIL"; exit 5; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[cred] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 6; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[cred] GRANTS_FAIL"; exit 8; }

echo "[cred] jeu d'essai (org + secrets chiffrés)…"
psql >/dev/null <<'SQL' || { echo "[cred] ORG_SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }
reset role;
insert into auth.users(id, email) values ('88888888-8888-8888-8888-888888888888','cred@bridge.test') on conflict do nothing;
set role authenticated;
select set_config('test.user_id','88888888-8888-8888-8888-888888888888', false);
select app.create_organization('Org Bridge','org-bridge');
SQL
# Capture de l'UUID seul (connexion superuser, hors RLS).
ORG=$(psql -tAc "select id from public.organizations where slug='org-bridge'" | tr -d '[:space:]')
[ -n "$ORG" ] || { echo "[cred] ORG_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 9; }

psql >/dev/null <<SQL || { echo "[cred] SEED_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 10; }
set role service_role;
select app.set_credential('$ORG', 'smartlead', 'sk-live-9999', '$KEY', '{}');
select app.set_credential('$ORG', 'francetravail', 'ft-secret-XYZ', '$KEY', '{"client_id":"FT-CLIENT-42"}');
SQL

echo "[cred] bundle du resolver (esbuild)…"
# On exécute depuis apps/worker : `pg`, `zod` et `@jay-reach/providers` y sont
# résolvables (pnpm ne les hisse pas à la racine).
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/apps/worker/src/credentials.ts" \
  --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_cred-bridge.mjs" >/dev/null 2>&1 \
  || { echo "[cred] BUNDLE_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 11; }
cp "$DIR/test/pg-verify/credentials-bridge.mjs" "$DIR/apps/worker/_cred-runner.mjs"

echo "[cred] exécution du test node…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  TEST_ORG="$ORG" TEST_KEY="$KEY" \
  node "$DIR/apps/worker/_cred-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_cred-bridge.mjs" "$DIR/apps/worker/_cred-runner.mjs"
"$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[cred] VERIFY_OK" || echo "[cred] VERIFY_FAIL"
exit "$RC"

# Socle commun des harnais de la connexion LinkedIn (lot 5, tâche 5) : conteneur Postgres 16 jetable,
# schéma des migrations, bundle des fonctions de production, exécution d'un runner .mjs.
# Variables attendues : T (préfixe de sortie), CT (nom du conteneur), PORT, RUNNER (nom du .mjs).
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"$DOCKER" info >/dev/null 2>&1 || { echo "$T DAEMON_FAIL"; exit 3; }
"$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "$T RUN_FAIL"; exit 4; }
fin() {
  rm -f "$DIR/apps/worker/_${RUNNER%.mjs}-runner.mjs" "$DIR/apps/worker/_${RUNNER%.mjs}-bundle.mjs"
  [ -n "${KEEP:-}" ] || "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
}
psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "$T PG_NOT_READY"; fin; exit 4; }

psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
  || { echo "$T EXTENSIONS_FAIL"; fin; exit 5; }
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "$T SHIM_FAIL"; fin; exit 6; }
for m in "$DIR"/supabase/migrations/*.sql; do
  # Une transaction par migration, comme `supabase db push`.
  psql -1 < "$m" >/dev/null || { echo "$T MIGRATION_FAIL: $(basename "$m")"; fin; exit 7; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "$T GRANTS_FAIL"; fin; exit 8; }

BUNDLE="$DIR/apps/worker/_${RUNNER%.mjs}-bundle.mjs"
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/test/pg-verify/linkedin-connexion-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" --outfile="$BUNDLE" >/dev/null 2>&1 \
  || { echo "$T BUNDLE_FAIL"; fin; exit 11; }
# Le runner importe le bundle sous un nom fixe.
sed "s#__BUNDLE__#./_${RUNNER%.mjs}-bundle.mjs#" "$DIR/test/pg-verify/$RUNNER" > "$DIR/apps/worker/_${RUNNER%.mjs}-runner.mjs"

DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  ENCRYPTION_KEY="$(printf 'k%.0s' $(seq 1 64) | tr 'k' 'a')" \
  node "$DIR/apps/worker/_${RUNNER%.mjs}-runner.mjs"
RC=$?
fin
[ "$RC" -eq 0 ] && echo "$T VERIFY_OK" || echo "$T VERIFY_FAIL"
exit "$RC"

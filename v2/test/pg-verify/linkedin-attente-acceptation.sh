#!/usr/bin/env bash
# Lot « prêt pour Alex », tâche 9 (#169) : preuve, sur un vrai Postgres 16, qu'un message LinkedIn
# refusé faute de relation ATTEND l'acceptation de l'invitation au lieu d'arrêter la séquence.
# Les fonctions de production sont exécutées telles quelles (tick, file, règlement du handler) ;
# seules les fixtures sont en SQL.
#
# Usage : bash test/pg-verify/linkedin-attente-acceptation.sh        (conteneur jetable)
#         KEEP=1 bash test/pg-verify/linkedin-attente-acceptation.sh (garde le conteneur)
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_attente_acceptation
PORT=55481
EMPREINTE="$(cat "$DIR/test/pg-verify/auth-shim.sql" "$DIR"/supabase/migrations/*.sql "$DIR/test/pg-verify/grants.sql" | cksum | awk '{print $1"-"$2}')"

echo "[attente-acceptation] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[attente-acceptation] DAEMON_FAIL"; exit 3; }

# Un conteneur qui porte le bon nom ne prouve rien : on ne le réutilise que s'il porte l'empreinte
# des migrations du jour.
harnais_pret() {
  "$DOCKER" ps --format '{{.Names}}' | grep -q "^$CT$" || return 1
  [ "$("$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc \
      'select empreinte from jr_harnais_pret' 2>/dev/null | tr -d '[:space:]')" = "$EMPREINTE" ]
}
if ! harnais_pret; then
  "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
  "$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
    -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[attente-acceptation] RUN_FAIL"; exit 4; }
  ok=0
  for i in $(seq 1 90); do
    if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [ "$ok" -ge 2 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 2 ] || { echo "[attente-acceptation] PG_NOT_READY"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 4; }

  psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
  psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
    || { echo "[attente-acceptation] EXTENSIONS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 5; }
  echo "[attente-acceptation] shim auth + migrations…"
  psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[attente-acceptation] SHIM_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 6; }
  for m in "$DIR"/supabase/migrations/*.sql; do
    case "$(basename "$m")" in 20261005130[3-9]*) FLAGS=-1 ;; *) FLAGS= ;; esac
    psql $FLAGS < "$m" >/dev/null || { echo "[attente-acceptation] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 7; }
  done
  psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[attente-acceptation] GRANTS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 8; }
  psql -c "create table jr_harnais_pret(empreinte text not null); insert into jr_harnais_pret values ('$EMPREINTE');" >/dev/null \
    || { echo "[attente-acceptation] TEMOIN_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 9; }
fi

echo "[attente-acceptation] bundle (esbuild)…"
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/test/pg-verify/linkedin-attente-acceptation-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" \
  --outfile="$DIR/apps/worker/_attente-acceptation-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[attente-acceptation] BUNDLE_FAIL"; exit 11; }
cp "$DIR/test/pg-verify/linkedin-attente-acceptation.mjs" "$DIR/apps/worker/_attente-acceptation-runner.mjs"

echo "[attente-acceptation] exécution…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  node "$DIR/apps/worker/_attente-acceptation-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_attente-acceptation-runner.mjs" "$DIR/apps/worker/_attente-acceptation-bundle.mjs"
[ -n "${KEEP:-}" ] || "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[attente-acceptation] VERIFY_OK" || echo "[attente-acceptation] VERIFY_FAIL"
exit "$RC"

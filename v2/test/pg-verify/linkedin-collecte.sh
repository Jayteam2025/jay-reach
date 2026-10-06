#!/usr/bin/env bash
# Lot 4a, tâche 7 : preuve, sur un vrai Postgres 16, du collecteur d'engageurs.
# Le handler de production est exécuté tel quel, avec un pilote de navigateur
# factice qui rend des réponses Voyager écrites ici : aucune connexion à
# LinkedIn, mais tout le reste est réel — session, verrou, plafonds, trace par
# requête, signaux, contacts, compteurs du passage, disjoncteur, producteur.
#
# Usage : bash test/pg-verify/linkedin-collecte.sh        (conteneur jetable)
#         KEEP=1 bash test/pg-verify/linkedin-collecte.sh (garde le conteneur)
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_collecte_linkedin
PORT=55455

echo "[linkedin-collecte] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[linkedin-collecte] DAEMON_FAIL"; exit 3; }

if ! "$DOCKER" ps --format '{{.Names}}' | grep -q "^$CT$"; then
  "$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
  "$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
    -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[linkedin-collecte] RUN_FAIL"; exit 4; }
  ok=0
  for i in $(seq 1 90); do
    if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [ "$ok" -ge 2 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 2 ] || { echo "[linkedin-collecte] PG_NOT_READY"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 4; }

  psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
  # Même préalable que la plateforme Supabase (cf. manques-cle-transport.sh) :
  # pgcrypto vit dans `extensions` AVANT les migrations ; le shim ne pose que le schéma.
  psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
    || { echo "[linkedin-collecte] EXTENSIONS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 5; }
  echo "[linkedin-collecte] shim auth + migrations…"
  psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[linkedin-collecte] SHIM_FAIL"; exit 6; }
  for m in "$DIR"/supabase/migrations/*.sql; do
    # Les migrations de cette tâche tournent chacune dans UNE transaction, comme
    # `supabase db push` : c'est ce qui rendrait une valeur d'enum inutilisable
    # dans le même fichier.
    case "$(basename "$m")" in 20261005130[3-9]*) FLAGS=-1 ;; *) FLAGS= ;; esac
    psql $FLAGS < "$m" >/dev/null || { echo "[linkedin-collecte] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 7; }
  done
  psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[linkedin-collecte] GRANTS_FAIL"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1; exit 8; }
fi

echo "[linkedin-collecte] bundles (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/test/pg-verify/linkedin-collecte-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" \
  --outfile="$DIR/apps/worker/_linkedin-collecte-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[linkedin-collecte] BUNDLE_FAIL"; exit 11; }
cp "$DIR/test/pg-verify/linkedin-collecte.mjs" "$DIR/apps/worker/_linkedin-collecte-runner.mjs"

echo "[linkedin-collecte] exécution…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  node "$DIR/apps/worker/_linkedin-collecte-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_linkedin-collecte-bundle.mjs" "$DIR/apps/worker/_linkedin-collecte-runner.mjs"
[ -n "${KEEP:-}" ] || "$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[linkedin-collecte] VERIFY_OK" || echo "[linkedin-collecte] VERIFY_FAIL"
exit "$RC"

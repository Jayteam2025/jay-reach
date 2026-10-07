#!/usr/bin/env bash
# Lot 4a, tâche 8 : preuve, sur un vrai Postgres 16, de l'achat d'une adresse pour
# une personne déjà identifiée — la première dépense d'argent du lot. La colonne de
# coût est réellement posée et remplie, le producteur ne retient que les personnes
# payables, le plafond de l'opérateur arrête l'achat, un conflit d'adresse
# n'interrompt rien, et la marque d'achat n'épargne de la purge que ce qui a
# vraiment une adresse. Le SQL de production est exécuté tel quel ; seul l'appel
# FullEnrich est injecté, donc rien n'est jamais payé.
#
# Usage : bash test/pg-verify/linkedin-enrichissement.sh        (conteneur jetable)
#         KEEP=1 bash test/pg-verify/linkedin-enrichissement.sh (garde le conteneur)
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_enrichissement
PORT=55456
EMPREINTE="$(cat "$DIR/test/pg-verify/auth-shim.sql" "$DIR"/supabase/migrations/*.sql "$DIR/test/pg-verify/grants.sql" | cksum | awk '{print $1"-"$2}')"

echo "[linkedin-enrichissement] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[linkedin-enrichissement] DAEMON_FAIL"; exit 3; }

# Un conteneur qui porte le bon nom ne prouve rien : une execution interrompue
# laisse une base vide, et un conteneur garde par KEEP=1 survit a l'ajout d'une
# migration. On ne le reutilise que s'il porte l'empreinte des migrations du jour.
harnais_pret() {
  "$DOCKER" ps --format '{{.Names}}' | grep -q "^$CT$" || return 1
  [ "$("$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc \
      'select empreinte from jr_harnais_pret' 2>/dev/null | tr -d '[:space:]')" = "$EMPREINTE" ]
}
if ! harnais_pret; then
  "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
  "$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
    -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[linkedin-enrichissement] RUN_FAIL"; exit 4; }
  ok=0
  for i in $(seq 1 90); do
    if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [ "$ok" -ge 2 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 2 ] || { echo "[linkedin-enrichissement] PG_NOT_READY"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 4; }

  psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
  # Même préalable que la plateforme Supabase (cf. manques-cle-transport.sh) :
  # pgcrypto vit dans `extensions` AVANT les migrations ; le shim ne pose que le schéma.
  psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
    || { echo "[linkedin-enrichissement] EXTENSIONS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 5; }
  echo "[linkedin-enrichissement] shim auth + migrations…"
  psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[linkedin-enrichissement] SHIM_FAIL"; exit 6; }
  for m in "$DIR"/supabase/migrations/*.sql; do
    # Les migrations de cette tâche tournent chacune dans UNE transaction, comme
    # `supabase db push` : c'est ce qui rendrait une valeur d'enum inutilisable
    # dans le même fichier.
    case "$(basename "$m")" in 20261005130[3-9]*) FLAGS=-1 ;; *) FLAGS= ;; esac
    psql $FLAGS < "$m" >/dev/null || { echo "[linkedin-enrichissement] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 7; }
  done
  psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[linkedin-enrichissement] GRANTS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 8; }
  psql -c "create table jr_harnais_pret(empreinte text not null); insert into jr_harnais_pret values ('$EMPREINTE');" >/dev/null \
    || { echo "[linkedin-enrichissement] TEMOIN_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 9; }
fi

echo "[linkedin-enrichissement] bundles (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/test/pg-verify/linkedin-enrichissement-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" \
  --outfile="$DIR/apps/worker/_linkedin-enrichissement-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[linkedin-enrichissement] BUNDLE_FAIL"; exit 11; }
cp "$DIR/test/pg-verify/linkedin-enrichissement.mjs" "$DIR/apps/worker/_linkedin-enrichissement-runner.mjs"

echo "[linkedin-enrichissement] exécution…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  node "$DIR/apps/worker/_linkedin-enrichissement-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_linkedin-enrichissement-bundle.mjs" "$DIR/apps/worker/_linkedin-enrichissement-runner.mjs"
[ -n "${KEEP:-}" ] || "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[linkedin-enrichissement] VERIFY_OK" || echo "[linkedin-enrichissement] VERIFY_FAIL"
exit "$RC"

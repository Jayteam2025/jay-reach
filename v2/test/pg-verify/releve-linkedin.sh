#!/usr/bin/env bash
# Lot réponses LinkedIn, tâche 4 : preuve, sur un vrai Postgres 16, du SQL de la relève. Le SQL de
# production est exécuté tel quel : rattachement par URN (trois formes) puis par URL (URL dégénérée,
# URL ambiguë), écriture du curseur (`$3` nul), trace de messagerie et contrainte d origine, et un
# passage complet du handler sur la vraie base.
#
# Usage : bash test/pg-verify/releve-linkedin.sh        (conteneur jetable)
#         KEEP=1 bash test/pg-verify/releve-linkedin.sh (garde le conteneur)
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_releve_linkedin
PORT=55471
EMPREINTE="$(cat "$DIR/test/pg-verify/auth-shim.sql" "$DIR"/supabase/migrations/*.sql "$DIR/test/pg-verify/grants.sql" | cksum | awk '{print $1"-"$2}')"

echo "[releve-linkedin] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[releve-linkedin] DAEMON_FAIL"; exit 3; }

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
    -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[releve-linkedin] RUN_FAIL"; exit 4; }
  ok=0
  for i in $(seq 1 90); do
    if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
      ok=$((ok+1)); [ "$ok" -ge 2 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 2 ] || { echo "[releve-linkedin] PG_NOT_READY"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 4; }

  psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
  # Même préalable que la plateforme Supabase (cf. manques-cle-transport.sh) :
  # pgcrypto vit dans `extensions` AVANT les migrations ; le shim ne pose que le schéma.
  psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null \
    || { echo "[releve-linkedin] EXTENSIONS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 5; }
  echo "[releve-linkedin] shim auth + migrations…"
  psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[releve-linkedin] SHIM_FAIL"; exit 6; }
  for m in "$DIR"/supabase/migrations/*.sql; do
    # Les migrations de cette tâche tournent chacune dans UNE transaction, comme
    # `supabase db push` : c'est ce qui rendrait une valeur d'enum inutilisable
    # dans le même fichier.
    case "$(basename "$m")" in 20261005130[3-9]*) FLAGS=-1 ;; *) FLAGS= ;; esac
    psql $FLAGS < "$m" >/dev/null || { echo "[releve-linkedin] MIGRATION_FAIL: $(basename "$m")"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 7; }
  done
  psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[releve-linkedin] GRANTS_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 8; }
  psql -c "create table jr_harnais_pret(empreinte text not null); insert into jr_harnais_pret values ('$EMPREINTE');" >/dev/null \
    || { echo "[releve-linkedin] TEMOIN_FAIL"; "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1; exit 9; }
fi

echo "[releve-linkedin] bundles (esbuild)…"
ESB="$DIR/apps/worker/node_modules/.bin/esbuild"
"$ESB" "$DIR/test/pg-verify/releve-linkedin-entree.ts" --bundle --platform=node --format=esm --packages=external \
  --alias:@jay-reach/core="$DIR/packages/core/src/index.ts" \
  --outfile="$DIR/apps/worker/_releve-linkedin-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[releve-linkedin] BUNDLE_FAIL"; exit 11; }
cp "$DIR/test/pg-verify/releve-linkedin.mjs" "$DIR/apps/worker/_releve-linkedin-runner.mjs"

echo "[releve-linkedin] exécution…"
DATABASE_URL="postgresql://postgres:postgres@localhost:$PORT/jayreach" \
  node "$DIR/apps/worker/_releve-linkedin-runner.mjs"
RC=$?

rm -f "$DIR/apps/worker/_releve-linkedin-bundle.mjs" "$DIR/apps/worker/_releve-linkedin-runner.mjs"
[ -n "${KEEP:-}" ] || "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
[ "$RC" -eq 0 ] && echo "[releve-linkedin] VERIFY_OK" || echo "[releve-linkedin] VERIFY_FAIL"
exit "$RC"

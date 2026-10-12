#!/usr/bin/env bash
# Lot 5, tâche 9 : preuve, sur un vrai Postgres 16, de la requête des six vérités de demarrage.ts
# (la liste de démarrage de l'écran Aujourd'hui). Le SQL est celui du produit, lu dans
# packages/core/src/fonctions/demarrage.ts ; conteneur jetable.
#
# Usage : bash test/pg-verify/demarrage.sh
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_demarrage
T="[demarrage]"

"$DOCKER" info >/dev/null 2>&1 || { echo "$T DAEMON_FAIL"; exit 3; }
"$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  postgres:16-alpine >/dev/null || { echo "$T RUN_FAIL"; exit 4; }
fin() { "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true; }
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

# Le SQL du worker, tel quel, en requêtes préparées ($n typés comme le pilote les infère).
PRELUDE="$(node --input-type=module -e "
import { SQL_DEMARRAGE } from '$DIR/packages/core/src/fonctions/demarrage-sql.ts';
console.log('prepare demarrage(uuid) as ' + SQL_DEMARRAGE + ';');
")" || { echo "$T PRELUDE_FAIL"; fin; exit 9; }
OUT="$({ echo "$PRELUDE"; cat "$DIR/test/pg-verify/demarrage.sql"; } | psql 2>&1)"
RC=$?
echo "$OUT" | grep -E "NOTICE|ERROR|VERIFY_OK|FAIL" | sed 's/^psql:[^ ]* //'
fin
[ "$RC" -eq 0 ] && echo "$T VERIFY_OK" || echo "$T VERIFY_FAIL"
exit "$RC"

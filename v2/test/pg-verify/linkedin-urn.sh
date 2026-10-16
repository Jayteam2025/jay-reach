#!/usr/bin/env bash
# Preuve de la migration `linkedin_urn_normalise` sur un vrai Postgres 16, deux sens :
#   1. toutes les migrations SAUF la sienne, des contacts aux deux formes, puis la sienne : état attendu ;
#   2. la même migration amputée de son UPDATE doit ÉCHOUER à son propre contrôle.
# Aucune connexion à une base distante : conteneur jetable, supprimé avec ses volumes.
set -uo pipefail
DOCKER="$(command -v docker || echo /usr/local/bin/docker)"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CT=jr_linkedin_urn
PORT=55467
MIG="$DIR/supabase/migrations/20261016110000_linkedin_urn_normalise.sql"
tag=linkedin-urn

"$DOCKER" info >/dev/null 2>&1 || { echo "[$tag] DAEMON_FAIL"; exit 3; }
nettoyer() { "$DOCKER" rm -f -v "$CT" >/dev/null 2>&1 || true; }
nettoyer
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[$tag] RUN_FAIL"; exit 4; }
ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then ok=$((ok+1)); [ "$ok" -ge 2 ] && break; else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[$tag] PG_NOT_READY"; nettoyer; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }
fail() { echo "[$tag] $1"; nettoyer; exit 1; }

psql -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; alter database jayreach set search_path = public, extensions;" >/dev/null || fail EXTENSIONS_FAIL
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || fail SHIM_FAIL
for m in "$DIR"/supabase/migrations/*.sql; do
  [ "$m" = "$MIG" ] && continue
  case "$(basename "$m")" in 20261005130[3-9]*) FLAGS=-1 ;; *) FLAGS= ;; esac
  psql $FLAGS < "$m" >/dev/null || fail "MIGRATION_FAIL: $(basename "$m")"
done

psql >/dev/null <<'SQL' || fail SEED_FAIL
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-0000000000a1', 'Org A', 'org-a');
insert into contacts (id, organization_id, email, linkedin_provider_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'complet@example.test',  'urn:li:fsd_profile:ACoAAB1234567890'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'nu@example.test',       'ACoAAB1234567891'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'ancien@example.test',   'urn:li:fs_miniProfile:ACoAAB1234567892'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'url@example.test',      'https://www.linkedin.com/in/jeanne-dupont'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'societe@example.test',  'urn:li:fsd_company:ACoAAB1234567893'),
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', 'vide@example.test',     null);
SQL

# Sens 2 d'abord, sur la base seedée : sans l'UPDATE, la migration doit échouer à son contrôle.
sed '/^update public.contacts/,/;$/d' "$MIG" | psql >/dev/null 2>"$DIR/../.pg-urn-err" && fail "SANS_CORRECTIF_PASSE_A_TORT"
grep -q "encore un URN LinkedIn complet" "$DIR/../.pg-urn-err" || { rm -f "$DIR/../.pg-urn-err"; fail "SANS_CORRECTIF_MAUVAISE_ERREUR"; }
rm -f "$DIR/../.pg-urn-err"
echo "[$tag] sans le correctif, le contrôle échoue : ok"

# Sens 1 : la vraie migration.
psql -1 < "$MIG" >/dev/null || fail "MIGRATION_FAIL: linkedin_urn_normalise"
ATTENDU='ACoAAB1234567890|ACoAAB1234567891|ACoAAB1234567892|https://www.linkedin.com/in/jeanne-dupont|urn:li:fsd_company:ACoAAB1234567893|'
LU="$(psql -tA -c "select string_agg(coalesce(linkedin_provider_id, ''), '|' order by id) from contacts" | tr -d '\n')"
[ "$LU" = "$ATTENDU" ] || fail "ETAT_INATTENDU: $LU"
# Idempotente : un second passage ne change rien.
psql -1 < "$MIG" >/dev/null || fail "REJEU_FAIL"
LU2="$(psql -tA -c "select string_agg(coalesce(linkedin_provider_id, ''), '|' order by id) from contacts" | tr -d '\n')"
[ "$LU2" = "$ATTENDU" ] || fail "REJEU_CHANGE_L_ETAT: $LU2"
echo "[$tag] état après migration conforme, rejeu sans effet"
nettoyer
echo "[$tag] VERIFY_OK"

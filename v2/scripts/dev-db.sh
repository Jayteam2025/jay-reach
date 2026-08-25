#!/usr/bin/env bash
# Base de données LOCALE de développement pour Jay Reach.
# Monte un Postgres 16 (docker), applique le schéma + un jeu de données minimal
# (une organisation « Démo » + deux sources d'offres d'emploi actives), pour
# faire tourner le worker en vrai. Aucune donnée sensible : que du schéma + seed.
#
# Usage :  bash scripts/dev-db.sh          (crée/initialise)
#          bash scripts/dev-db.sh reset    (remet à zéro)
set -uo pipefail
DOCKER=/usr/local/bin/docker
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CT=jr_dev
PORT=54329

if [ "${1:-}" = "reset" ]; then
  echo "[db] remise à zéro…"; "$DOCKER" rm -f "$CT" >/dev/null 2>&1 || true
fi

echo "[db] démarrage de Docker…"
open -a Docker >/dev/null 2>&1 || true
for i in $(seq 1 120); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 2; done
"$DOCKER" info >/dev/null 2>&1 || { echo "[db] Docker ne démarre pas"; exit 3; }

# Réutilise le conteneur s'il tourne déjà.
if "$DOCKER" ps --format '{{.Names}}' | grep -q "^$CT$"; then
  echo "[db] déjà en marche sur le port $PORT — rien à faire."
  echo "[db] (pour repartir de zéro : bash scripts/dev-db.sh reset)"
  exit 0
fi
"$DOCKER" start "$CT" >/dev/null 2>&1 && { echo "[db] conteneur redémarré sur le port $PORT."; exit 0; }

echo "[db] création du conteneur Postgres 16 (port $PORT)…"
"$DOCKER" run -d --name "$CT" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jayreach \
  -p "$PORT":5432 postgres:16-alpine >/dev/null || { echo "[db] échec de création"; exit 4; }

psql() { "$DOCKER" exec -i "$CT" psql -v ON_ERROR_STOP=1 -U postgres -d jayreach "$@"; }

ok=0
for i in $(seq 1 90); do
  if "$DOCKER" exec "$CT" psql -U postgres -d jayreach -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok+1)); [ "$ok" -ge 2 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 2 ] || { echo "[db] Postgres pas prêt"; exit 4; }

echo "[db] schéma (shim auth + migrations + grants)…"
psql < "$DIR/test/pg-verify/auth-shim.sql" >/dev/null || { echo "[db] SHIM_FAIL"; exit 5; }
for m in "$DIR"/supabase/migrations/*.sql; do
  psql < "$m" >/dev/null || { echo "[db] MIGRATION_FAIL: $(basename "$m")"; exit 6; }
done
psql < "$DIR/test/pg-verify/grants.sql" >/dev/null || { echo "[db] GRANTS_FAIL"; exit 8; }

echo "[db] jeu de données (org Démo + sources)…"
psql >/dev/null <<'SQL' || { echo "[db] SEED_FAIL"; exit 9; }
reset role;
insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111','demo@jay-reach.local') on conflict do nothing;
set role authenticated;
select set_config('test.user_id','11111111-1111-1111-1111-111111111111', false);
select app.create_organization('Démo', 'demo');
reset role;
insert into public.sources (organization_id, provider_id, name, config, is_active)
select o.id, v.provider, v.name, v.config::jsonb, true
from public.organizations o,
     (values
        ('apify',         'Apify — offres LinkedIn commerciaux', '{"keywords":["commercial"],"location":"Lyon"}'),
        ('francetravail', 'France Travail — commerciaux',         '{"keywords":["commercial"],"location":"Lyon"}'),
        ('adzuna',        'Adzuna — commerciaux',                 '{"keywords":["commercial"],"location":"Lyon"}')
     ) as v(provider, name, config)
where o.slug = 'demo'
  and not exists (select 1 from public.sources s where s.organization_id = o.id and s.name = v.name);
SQL

echo "[db] ✅ base locale prête — postgresql://postgres:postgres@localhost:$PORT/jayreach"
psql -c "select o.name as org, s.provider_id, s.name, s.config->>'keywords' as mots_cles from sources s join organizations o on o.id=s.organization_id;"

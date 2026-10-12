#!/usr/bin/env bash
# Preuve que LISTEN/NOTIFY traverse le pooler Supabase (lot 5, canal jr_linkedin_connexion).
# Contre la base OSS : aucune écriture, un pg_notify seulement. Deux connexions distinctes.
# Le port décide : 5432 = mode session (LISTEN permis), 6543 = mode transaction (non).
# Le harnais FORCE 5432 par défaut ; PORT=6543 pour mesurer le piège.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-5432}"
[ -f "$DIR/.env" ] || { echo "[listen] .env introuvable"; exit 3; }
URL=$(grep '^DATABASE_URL=' "$DIR/.env" | cut -d= -f2- | tr -d '"')
[ -n "$URL" ] || { echo "[listen] DATABASE_URL absent"; exit 3; }
cp "$DIR/test/pg-verify/listen-notify.mjs" "$DIR/apps/worker/_listen-runner.mjs"
DATABASE_URL="$URL" PORT="$PORT" node "$DIR/apps/worker/_listen-runner.mjs"
RC=$?
rm -f "$DIR/apps/worker/_listen-runner.mjs"
exit "$RC"

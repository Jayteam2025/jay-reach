#!/usr/bin/env bash
# Preuve de l'aller-retour du canal chiffré jr_linkedin_connexion (lot 5) contre la base OSS :
# aucune écriture, un pg_notify chiffré seulement. L'écoute impose le mode session (5432) ;
# LISTEN_PORT règle le port de l'ÉMISSION (5432 par défaut). Le port décide :
# 5432 = mode session, 6543 = mode transaction (où LISTEN se tait sans erreur).
set -uo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LISTEN_PORT="${LISTEN_PORT:-5432}"
[ -f "$DIR/.env" ] || { echo "[listen] .env introuvable"; exit 3; }
URL=$(grep '^DATABASE_URL=' "$DIR/.env" | cut -d= -f2- | tr -d '"')
KEY=$(grep '^ENCRYPTION_KEY=' "$DIR/.env" | cut -d= -f2- | tr -d '"')
[ -n "$URL" ] || { echo "[listen] DATABASE_URL absent"; exit 3; }
[ -n "$KEY" ] || { echo "[listen] ENCRYPTION_KEY absent"; exit 3; }
cp "$DIR/test/pg-verify/listen-notify.mjs" "$DIR/apps/worker/_listen-runner.mts"
( cd "$DIR/apps/worker" && DATABASE_URL="$URL" ENCRYPTION_KEY="$KEY" LISTEN_PORT="$LISTEN_PORT" npx tsx ./_listen-runner.mts )
RC=$?
rm -f "$DIR/apps/worker/_listen-runner.mts"
exit "$RC"

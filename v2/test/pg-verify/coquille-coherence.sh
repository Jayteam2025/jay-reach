#!/usr/bin/env bash
# P3 : exécute RÉELLEMENT `lireAujourdhui` et `lireResumeCoquille` (menu de gauche) sur une
# vraie base et vérifie qu'ils s'accordent (badge, file du jour, plafond, moteur, fuseau), et
# que `listerCampagnesPourFiltre` rend la même liste que `listerCampagnes` en une requête.
#
# LECTURE SEULE : aucun insert/update, donc sans risque sur la base OSS (mono-opérateur, port
# 6543 en mode transaction). Cible = DATABASE_URL de l'environnement, sinon celle de v2/.env.
#   usage : DATABASE_URL=postgresql://... test/pg-verify/coquille-coherence.sh
set -uo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [ -z "${DATABASE_URL:-}" ]; then
  ENV_FILE="$DIR/.env"
  [ -f "$ENV_FILE" ] || ENV_FILE="$(cd "$DIR" && git rev-parse --git-common-dir)/../v2/.env"
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
[ -n "$DATABASE_URL" ] || { echo "[coquille] DATABASE_URL introuvable"; exit 2; }

echo "[coquille] bundle (esbuild)…"
cat > "$DIR/apps/worker/_coquille-entry.ts" <<'TS'
export { lireAujourdhui, lireResumeCoquille } from '../../packages/core/src/fonctions/aujourdhui.ts';
export { listerCampagnes, listerCampagnesPourFiltre } from '../../packages/core/src/fonctions/campagnes.ts';
TS
"$DIR/apps/worker/node_modules/.bin/esbuild" "$DIR/apps/worker/_coquille-entry.ts" \
  --bundle --platform=node --format=esm --packages=external \
  --outfile="$DIR/apps/worker/_coquille-bundle.mjs" >/dev/null 2>&1 \
  || { echo "[coquille] BUNDLE_FAIL"; rm -f "$DIR/apps/worker/_coquille-entry.ts"; exit 11; }
cp "$DIR/test/pg-verify/coquille-coherence.mjs" "$DIR/apps/worker/_coquille-runner.mjs"

DATABASE_URL="$DATABASE_URL" node "$DIR/apps/worker/_coquille-runner.mjs"
RC=$?
rm -f "$DIR/apps/worker/_coquille-entry.ts" "$DIR/apps/worker/_coquille-bundle.mjs" "$DIR/apps/worker/_coquille-runner.mjs"
[ "$RC" -eq 0 ] && echo "[coquille] VERIFY_OK" || echo "[coquille] VERIFY_FAIL"
exit "$RC"

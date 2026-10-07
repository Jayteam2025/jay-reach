#!/usr/bin/env bash
# Lance Chromium derrière le proxy résidentiel, et le relais CDP.
set -euo pipefail

# Sans proxy, Chromium sortirait par l'IP publique du VPS, celle des bots de
# production : refus net plutôt que repli silencieux. La valeur n'est jamais affichée.
if [[ -z "${LINKEDIN_PROXY_URL:-}" ]]; then
  echo "LINKEDIN_PROXY_URL absent : le navigateur ne démarre pas sans proxy." >&2
  exit 1
fi
# Forme stricte schéma://hôte:port. Une URL qui s'en écarte (schéma inconnu, identifiants,
# chemin) ferait ignorer la règle par Chromium, qui sortirait alors en direct par l'IP du VPS.
# Chromium refuse de toute façon `user:pass@hôte` : les identifiants passent par CDP côté worker.
if ! [[ "$LINKEDIN_PROXY_URL" =~ ^(https?)://[^/@:]+:[0-9]+$ ]]; then
  echo "LINKEDIN_PROXY_URL doit être de la forme schéma://hôte:port (http ou https), sans identifiants." >&2
  exit 1
fi

PROFIL="${PROFIL_DIR:-/profil}"

# Verrous de profil laissés par un conteneur précédent (OOM, `docker kill`, redémarrage de
# l'hôte). Chromium y lit le nom d'hôte du propriétaire, conclut que le profil est utilisé
# ailleurs et sort : avec `restart: unless-stopped`, ce serait une boucle sans fin. Il n'y a
# qu'un Chromium par conteneur et par profil : supprimer est sans risque.
rm -f "$PROFIL/SingletonLock" "$PROFIL/SingletonSocket" "$PROFIL/SingletonCookie"

# `--headless=new` annonce « HeadlessChrome » dans le User-Agent, signature que LinkedIn
# traite en défi ou en 999. On annonce Chrome, avec la version RÉELLE du binaire pour que
# l'annonce reste cohérente avec ce qu'il sait faire.
VERSION="$(chromium --version | grep -oE '[0-9]+(\.[0-9]+){3}' | head -n1)"
if [[ -z "$VERSION" ]]; then
  echo "Version de Chromium illisible." >&2
  exit 1
fi
USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION} Safari/537.36"

# Le relais écoute sur toutes les interfaces du conteneur : Chromium n'accepte
# le DevTools que sur 127.0.0.1.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

# `env -i` : défense en profondeur, Chromium ne reçoit que PATH, HOME, le fuseau et la
# langue (le conteneur ne charge de toute façon que navigateur.env). TZ et LANG sont
# posés exprès : sans eux le navigateur serait en UTC et en anglais américain derrière
# une IP française, incohérence que LinkedIn mesure.
exec env -i PATH="$PATH" HOME="$HOME" TZ=Europe/Paris LANG=fr_FR.UTF-8 chromium \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --user-data-dir="$PROFIL" \
  --user-agent="$USER_AGENT" \
  --lang=fr-FR \
  --password-store=basic \
  --disable-background-networking \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --proxy-server="$LINKEDIN_PROXY_URL" \
  --webrtc-ip-handling-policy=disable_non_proxied_udp \
  --force-webrtc-ip-handling-policy \
  --no-first-run \
  --no-default-browser-check \
  about:blank

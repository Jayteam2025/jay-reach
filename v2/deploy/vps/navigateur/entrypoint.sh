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

# Le relais écoute sur toutes les interfaces du conteneur : Chromium n'accepte
# le DevTools que sur 127.0.0.1.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

# `env -i` : défense en profondeur, Chromium ne reçoit que PATH et HOME (le conteneur
# ne charge de toute façon que navigateur.env).
exec env -i PATH="$PATH" HOME="$HOME" chromium \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --user-data-dir=/profil \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --proxy-server="$LINKEDIN_PROXY_URL" \
  --webrtc-ip-handling-policy=disable_non_proxied_udp \
  --force-webrtc-ip-handling-policy \
  --no-first-run \
  --no-default-browser-check \
  about:blank

#!/usr/bin/env bash
# Met à jour et relance le worker Jay Reach sur ce serveur.
# Usage : ./deployer.sh [--force-recreate]
# --force-recreate est nécessaire après toute modification du fichier d'environnement.
set -euo pipefail

main() {
  cd "$(dirname "$0")"
  RACINE="$(git rev-parse --show-toplevel)"

  git -C "$RACINE" pull --ff-only
  GIT_SHA="$(git -C "$RACINE" rev-parse --short HEAD)"
  export GIT_SHA

  docker compose -p jay-reach build
  if [[ "${1:-}" == "--force-recreate" ]]; then
    docker compose -p jay-reach up -d --force-recreate
  else
    docker compose -p jay-reach up -d
  fi

  docker compose -p jay-reach ps
  docker compose -p jay-reach logs --tail=10 worker
}

# Le corps est dans une fonction, appelée ici en dernière ligne : le `git pull`
# ci-dessus modifie potentiellement ce fichier pendant sa propre exécution, et
# bash relit un script par décalage d'octets. Si le script grossissait ou
# rétrécissait en cours de lecture, la suite exécutée pourrait être corrompue.
# Une fonction est lue en entier avant d'être appelée : le pull ne peut plus
# affecter ce qui s'exécute après lui dans ce passage.
main "$@"

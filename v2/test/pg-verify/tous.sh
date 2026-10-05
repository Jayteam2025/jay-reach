#!/usr/bin/env bash
# Lance TOUS les harnais de vérification sur Postgres réel, et dit lesquels
# échouent.
#
# POURQUOI CE FICHIER. `run.sh` monte sa propre base et joue les fichiers `.sql`
# du filet de schéma. Les autres harnais sont des scripts autonomes, chacun avec
# son conteneur — et rien ne les lançait ensemble. Relevé le 05/10/2026 :
# dix-huit harnais sur dix-neuf n'étaient exécutés par aucune commande. Ils
# étaient écrits, maintenus, cités dans les revues, et jamais joués. C'est la
# même histoire que le shim auquel il manquait deux lignes : l'outillage existe,
# personne ne s'en sert, et le jour où on en a besoin il ne marche plus.
#
# Ce script ne s'arrête PAS au premier échec : un harnais cassé ne doit pas
# masquer l'état des dix-huit autres. Il rend 0 si tout passe, 1 sinon, et la
# liste des échecs en fin de sortie.
#
# C'est long — chaque harnais monte son propre Postgres, comptez une poignée de
# minutes par script. `SEUL=<motif>` n'en lance qu'une partie :
#     SEUL=contacts ./tous.sh
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
MOTIF="${SEUL:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[tous] docker introuvable — ces harnais en ont besoin."
  exit 2
fi

harnais=()
for f in "$DIR"/*.sh; do
  nom="$(basename "$f")"
  [ "$nom" = "tous.sh" ] && continue
  [ -n "$MOTIF" ] && [[ "$nom" != *"$MOTIF"* ]] && continue
  harnais+=("$nom")
done

if [ ${#harnais[@]} -eq 0 ]; then
  echo "[tous] aucun harnais ne correspond à « $MOTIF »."
  exit 2
fi

echo "[tous] ${#harnais[@]} harnais à lancer. Chacun monte son propre Postgres."
echo

reussis=()
echecs=()
for nom in "${harnais[@]}"; do
  printf '[tous] %-32s ' "$nom"
  debut=$SECONDS
  if sortie="$(bash "$DIR/$nom" 2>&1)"; then
    echo "OK ($((SECONDS - debut))s)"
    reussis+=("$nom")
  else
    echo "ÉCHEC ($((SECONDS - debut))s)"
    echecs+=("$nom")
    # Les trois dernières lignes suffisent à situer la panne ; le reste est le
    # bruit des migrations.
    echo "$sortie" | tail -3 | sed 's/^/        /'
  fi
done

echo
echo "[tous] ${#reussis[@]} réussis, ${#echecs[@]} en échec."
if [ ${#echecs[@]} -gt 0 ]; then
  printf '[tous] en échec : %s\n' "${echecs[*]}"
  exit 1
fi
echo "[tous] TOUS_OK"

#!/usr/bin/env bash
# Lot 5, tâche 5, étape 6 (spec §14) : preuve qu'AUCUN secret ne subsiste. Une connexion complète est
# jouée de bout en bout (demande, canal chiffré, worker, défi, code, réussite) sur un vrai Postgres,
# puis TOUTES les tables et le journal du worker sont balayés à la recherche de l'identifiant, du mot de
# passe et du code. Le balayeur est lui-même éprouvé sur une valeur plantée.
#
# Usage : export COLIMA_HOME="/Volumes/SSD-JB/DevEnv/Colima" && bash test/pg-verify/linkedin-connexion-sans-secret.sh
set -uo pipefail
T="[linkedin-connexion-sans-secret]"; CT=jr_linkedin_connexion_sans_secret; PORT=55472; RUNNER=linkedin-connexion-sans-secret.mjs
. "$(dirname "$0")/linkedin-connexion-lib.sh"

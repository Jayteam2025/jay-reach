#!/usr/bin/env bash
# Lot 5, tâche 5 : preuve, sur un vrai Postgres 16, du SQL des actions de connexion LinkedIn (cœur
# et worker) et de leur comportement de bout en bout sur une vraie base : une seule demande en
# cours, fermeture après trois échecs, worker absent, annulation, clôture de repli, purge.
#
# Usage : export COLIMA_HOME="/Volumes/SSD-JB/DevEnv/Colima" && bash test/pg-verify/linkedin-connexion-actions.sh
set -uo pipefail
T="[linkedin-connexion-actions]"; CT=jr_linkedin_connexion_actions; PORT=55471; RUNNER=linkedin-connexion-actions.mjs
. "$(dirname "$0")/linkedin-connexion-lib.sh"

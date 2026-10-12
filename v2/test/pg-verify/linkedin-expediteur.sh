#!/usr/bin/env bash
# Lot 5, tâche 6 : preuve, sur un vrai Postgres 16, de l'expéditeur LinkedIn garanti (une ligne active,
# et une seule, la plus ancienne reprise) et de la déconnexion (cookies effacés, expéditeur désactivé).
# Le cas réel du 12/10 (deux lignes `jb-linkedin`) est un cas du harnais.
#
# Usage : export COLIMA_HOME="/Volumes/SSD-JB/DevEnv/Colima" && bash test/pg-verify/linkedin-expediteur.sh
set -uo pipefail
T="[linkedin-expediteur]"; CT=jr_linkedin_expediteur; PORT=55473; RUNNER=linkedin-expediteur.mjs
. "$(dirname "$0")/linkedin-connexion-lib.sh"

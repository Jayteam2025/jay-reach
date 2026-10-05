// Point d'entrée du bundle de jauge-envois.sh : réexporte, sans les modifier, les
// fonctions de production dont le SQL est exécuté par le harnais. Le worker figure
// ici parce que la jauge doit dire la MÊME chose que lui : c'est lui qui décide ce
// qui part réellement.
export { lirePlafondEnvois, lireConsommationDuJour } from '../../packages/core/src/fonctions/plafonds.js';
export { lireAujourdhui, lireResumeCoquille } from '../../packages/core/src/fonctions/aujourdhui.js';
export { listerFileDuJour } from '../../packages/core/src/fonctions/campagnes.js';
export { chargerContraintesSender, quotaSenderRestant } from '../../apps/worker/src/handlers/sequence.js';

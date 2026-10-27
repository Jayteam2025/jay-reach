// Point d'entrée du bundle de sequence-canaux.sh : réexporte, sans les modifier, les fonctions de
// production que le harnais exécute (rang des étapes, compte des « allés au bout », canaux).
export { lireSequence } from '../../packages/core/src/fonctions/sequence.js';
export { lireVueDEnsemble, listerCampagnes, listerFileDuJour, listerActivite, manquesPourLancer } from '../../packages/core/src/fonctions/campagnes.js';
export { lireAujourdhui } from '../../packages/core/src/fonctions/aujourdhui.js';
export { apercuEnvoi } from '../../packages/core/src/fonctions/file-du-jour.js';
export { lireFiche } from '../../packages/core/src/fonctions/contacts.js';

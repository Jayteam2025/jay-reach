// Point d'entrée du bundle de linkedin-envoi.sh : réexporte, sans la modifier, la fonction de
// production qui règle une action LinkedIn (file, action de séquence, inscription).
export { regler } from '../../apps/worker/src/handlers/envoi-linkedin.js';
// Le balayage de rattrapage du tick et les deux fonctions de la file qui rendent une ligne terminale.
export { mettreEnPauseActionsLinkedInOrphelines } from '../../apps/worker/src/traitements.js';
export { remettreActionEnAttente, reparerLignesCoincees } from '../../packages/core/src/linkedin/file.js';

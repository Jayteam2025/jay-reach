// Point d'entrée du bundle de linkedin-envoi.sh : réexporte, sans la modifier, la fonction de
// production qui règle une action LinkedIn (file, action de séquence, inscription).
export { regler } from '../../apps/worker/src/handlers/envoi-linkedin.js';

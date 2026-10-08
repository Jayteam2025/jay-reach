// Point d'entrée du bundle de linkedin-envoi.sh : réexporte, sans la modifier, la fonction de
// production qui règle une action LinkedIn (file, action de séquence, inscription).
export { regler } from '../../apps/worker/src/handlers/envoi-linkedin.js';
// Le balayage de rattrapage du tick et les deux fonctions de la file qui rendent une ligne terminale.
export { mettreEnPauseActionsLinkedInOrphelines, rejouerActionsLinkedInReprises, rejouerActionsLinkedInEnAttente } from '../../apps/worker/src/traitements.js';
export { remettreActionEnAttente, reparerLignesCoincees } from '../../packages/core/src/linkedin/file.js';
// La reprise par l'opérateur (core) et la clé d'idempotence de l'action qu'elle rejoue.
export { reprendreInscription } from '../../packages/core/src/fonctions/sequence.js';
export { actionIdempotencyKey } from '../../packages/core/src/sequencer/actions.js';
// Le chemin email, pour prouver que ses deux sites de pause lisent le même RANG que le chemin LinkedIn.
export { envoyerEmailSalesBlink } from '../../apps/worker/src/handlers/email-salesblink.js';
export { rangDeLEtape } from '../../apps/worker/src/handlers/sequence.js';
export { ErreurSalesBlink } from '../../packages/providers/src/outreach/index.js';
// La normalisation d'adresse LinkedIn du JS, pour la confronter à sa jumelle SQL.
export { normalizeLinkedin } from '../../packages/core/src/import/pipeline.js';

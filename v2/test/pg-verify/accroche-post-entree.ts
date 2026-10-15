// Point d'entrée du bundle de accroche-post.sh : réexporte, sans les modifier, les fonctions de
// production que le harnais exécute. Les tâches suivantes du lot y ajoutent les leurs.
export { clePost, enregistrerFichePost, rattacherSignalAuPost, ficheIncomplete } from '../../apps/worker/src/linkedin/posts-fiches.js';
export { enregistrerEngageur } from '../../apps/worker/src/handlers/post-engagement.js';
export { marquerPostTraite } from '../../apps/worker/src/linkedin/posts-traites.js';
export { startSourceRun } from '../../apps/worker/src/db.js';
export { creerSource } from '../../packages/core/src/fonctions/sources.js';

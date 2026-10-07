// Point d'entrée du bundle de linkedin-enrichissement.sh : réexporte, sans les
// modifier, les fonctions de production dont le SQL est exécuté par le harnais.
export {
  enrichirContactConnu,
  raisonDeNePasAcheter,
  MSG,
} from '../../apps/worker/src/handlers/enrichment-contact-connu.js';
export { enqueueEnrichmentContactsConnus, ecarterSignauxTropAnciens } from '../../apps/worker/src/producer.js';
export { enregistrerEngageur } from '../../apps/worker/src/handlers/post-engagement.js';
export { runScore } from '../../apps/worker/src/handlers/score.js';
export { persistEnrichedContact } from '../../apps/worker/src/enrichment-persist.js';
export { ecrireReglage } from '@jay-reach/core';
// Le vrai runtime pg-boss : la section `fileReelle` prouve sur lui le
// dédoublonnage par identifiant, le comptage des jobs réellement créés et la
// politique de reprise déclarée.
export { createRuntime, registerQueues } from '../../apps/worker/src/runtime.js';
export { normaliserUrlPost } from '@jay-reach/core';

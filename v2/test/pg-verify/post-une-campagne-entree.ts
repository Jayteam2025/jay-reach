// Point d'entrée du bundle de post-une-campagne.sh : réexporte, sans les
// modifier, les fonctions de production dont le SQL est exécuté par le harnais.
export { ErreurEntree } from '../../packages/core/src/fonctions/contexte.js';
export { creerSource, modifierSource } from '../../packages/core/src/fonctions/sources.js';
export { creerCampagne, modifierReglagesCampagne } from '../../packages/core/src/fonctions/campagnes.js';

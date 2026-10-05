// Point d'entrée du bundle de linkedin-plafonds.sh : réexporte, sans les
// modifier, les fonctions de production dont le SQL est exécuté par le harnais.
export {
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  lirePlafondLinkedIn,
  tracerRequeteLinkedIn,
} from '../../packages/core/src/fonctions/plafonds.js';

// Point d'entrée du bundle des harnais `linkedin-connexion-actions.sh` et `linkedin-connexion-sans-secret.sh` :
// réexporte, sans les modifier, les fonctions de PRODUCTION de la connexion LinkedIn depuis l'écran.
export {
  annulerConnexion,
  demanderConnexion,
  demanderDeconnexion,
  lireDemandeEnCours,
  repondreDefi,
  ErreurAucunCodeAttendu,
  ErreurConnexionEnCours,
  ErreurFormulaireFerme,
  CANAL_CONNEXION_LINKEDIN,
  lireMessageConnexion,
  activerSessionLinkedIn,
  lireSessionLinkedIn,
  garantirExpediteurLinkedIn,
  desactiverExpediteurLinkedIn,
} from '../../packages/core/src/index.js';
export { traiterMessageConnexion, oublierConnexionsEnCours, cloreDemandesOrphelines } from '../../apps/worker/src/linkedin/traiter-connexion.js';
export { dependancesWeb } from '../../apps/worker/src/linkedin/dependances-web.js';
export {
  SQL_ACCUSER_RECEPTION,
  SQL_CLORE_SI_EN_COURS,
  SQL_PURGER,
} from '../../apps/worker/src/linkedin/traiter-connexion-sql.js';
export { deconnecter } from '../../apps/worker/src/cli/linkedin.js';

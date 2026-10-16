// Point d'entrée du bundle de releve-linkedin.sh : réexporte, sans les modifier, les fonctions de
// production dont le SQL est exécuté par le harnais.
export { notifierReponseEntrante, balayerReponsesNonNotifiees, enqueueReleveLinkedIn, ecrireEtat, lireEtat, rattacher, traiterReleveLinkedIn, contactsSansUrn, REQUETES_PAR_RELEVE } from '../../apps/worker/src/handlers/releve-linkedin.js';
export { compterRequetesLinkedIn, lirePlafondLinkedIn, tracerRequeteMessagerie } from '@jay-reach/core';
export { urlConversations } from '../../apps/worker/src/linkedin/messagerie.js';
export { enregistrerMessageSortant, toucherDernierMessage } from '@jay-reach/core';
// Tâche 7 : l'exclusion automatique sur une réponse humaine, et la garde d'entrée qui la fait tenir.
export { recordInboundReply, exclureApresReponse, nePlusContacter, poserExclusion } from '@jay-reach/core';
export { enrollContact, inscrireContact } from '../../apps/worker/src/handlers/sequence.js';
// Tâche 8 : l'annulation des envois en file à l'exclusion, et la garde de la réclamation.
export { reclamerProchaineAction } from '../../packages/core/src/linkedin/file.js';
// Tâche 9 : répondre depuis Jay Reach (enfilement, état du message du fil, échec signalé) et le rythme de la file.
export { enfilerReponseLinkedIn, marquerReponseEnvoyee, signalerEchecReponse, repondreAuFil, ErreurReponseImpossible } from '@jay-reach/core';
export { prochainEnvoiLinkedIn } from '@jay-reach/core';
export { reparerLignesCoincees } from '../../packages/core/src/linkedin/file.js';
export { regler } from '../../apps/worker/src/handlers/envoi-linkedin.js';
// Tâche 10 : le rejeu du classement sur l'existant.
export { rejouerClassement } from '@jay-reach/core';
// Revue finale : la liste de la Réception (aperçu du dernier message), la relève hors jours d'envoi et le filet des notifications,
// l'import CSV et l'inscription depuis une liste (garde d'entrée), le compte vu par la relève.
export { listerFils, importerCsv, ajouterDepuisListe } from '@jay-reach/core';

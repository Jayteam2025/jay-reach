// Point d'entrée du bundle de accroche-post.sh : réexporte, sans les modifier, les fonctions de
// production que le harnais exécute. Les tâches suivantes du lot y ajoutent les leurs.
export { clePost, enregistrerFichePost, fichesARattraper, rattacherSignalAuPost, ficheIncomplete, TENTATIVES_SUJET_MAX } from '../../apps/worker/src/linkedin/posts-fiches.js';
export { enregistrerEngageur } from '../../apps/worker/src/handlers/post-engagement.js';
export { marquerPostTraite } from '../../apps/worker/src/linkedin/posts-traites.js';
export { startSourceRun } from '../../apps/worker/src/db.js';
export { creerSource } from '../../packages/core/src/fonctions/sources.js';
export { traiterCollecteLinkedIn } from '../../apps/worker/src/handlers/collecte-linkedin.js';
export { activerSessionLinkedIn } from '../../packages/core/src/fonctions/linkedin-session.js';
export { enqueueFichesPostALire, prendreCreditAnthropic, traiterFichePost } from '../../apps/worker/src/handlers/fiche-post.js';
export { prendreVerrouLinkedIn } from '../../packages/core/src/fonctions/linkedin-session.js';
export { registerQueues } from '../../apps/worker/src/runtime.js';
export { chargerLigneInscription, buildMessageValues } from '../../apps/worker/src/handlers/message-values.js';
export { lireValeursContact } from '../../packages/core/src/messages/valeurs-contact.js';
export { renderTemplate, validateTemplateVariables } from '../../packages/core/src/messages/variables.js';
// Tache 8 : la garde d'entree, la fenetre de decision, le gel de la depense.
export { enqueueEnrollments, enqueueEnrichmentContactsConnus, ecarterSignauxTropAnciens, AGE_MAX_SIGNAL_JOURS } from '../../apps/worker/src/producer.js';
export { enrollContact, tickDueEnrollments } from '../../apps/worker/src/handlers/sequence.js';
export { enrichirContactConnu } from '../../apps/worker/src/handlers/enrichment-contact-connu.js';
export { fenetreValidationPost, rejeterFichesPostExpirees } from '../../apps/worker/src/linkedin/posts-fiches.js';
export { achatRetenuParUnPost, campagneNommeUnPost, compterRetenuesParPost, retenuesAAfficher, envoiRetenuParUnPost } from '../../packages/core/src/linkedin/accroche-post.js';
export { ecrireReglage } from '../../packages/core/src/fonctions/plafonds.js';
// L'objet d'un email se replie sur le NOM du gabarit : `apercuEnvoi` fait ce repli sur de vraies donnees.
export { apercuEnvoi } from '../../packages/core/src/fonctions/file-du-jour.js';
// Et la File du jour, troisieme lecteur du meme repli : elle lit la colonne brute du gabarit.
export { listerFileDuJour } from '../../packages/core/src/fonctions/campagnes.js';
// Les deux rejeux LinkedIn et le rejeu email : eux aussi rendent le corps APRES coup.
export { rejouerActionsEmailEnAttente, rejouerActionsLinkedInEnAttente, rejouerActionsLinkedInReprises } from '../../apps/worker/src/traitements.js';
// Tache 9 : le scoring nourri du texte du post.
export { runScore, compterSignauxScorables } from '../../apps/worker/src/handlers/score.js';
export { buildScoringUserMessage } from '../../packages/core/src/scoring.js';
// Tache 10 : l'ecran de validation des posts.
export {
  compterPostsAValiderDeCampagne,
  corrigerAuteurDePost,
  corrigerSujetDePost,
  decouperAccroche,
  listerPostsDeCampagne,
  rejeterPost,
  reouvrirPost,
  validerPost,
} from '../../packages/core/src/fonctions/posts.js';

/**
 * Jay Reach — Génère le Google Form de candidature contributeur.
 *
 * UTILISATION (une seule fois) :
 *   1. Va sur https://script.google.com → Nouveau projet
 *   2. Colle ce fichier en entier
 *   3. Exécute la fonction `createContributorForm`
 *   4. Autorise l'accès quand Google le demande
 *   5. Récupère l'URL du formulaire + l'URL d'édition dans les logs (Affichage → Journaux)
 *
 * Le formulaire collecte ce qu'il faut pour inviter quelqu'un en outside collaborator
 * sur le repo privé Jayteam2025/jay-reach : surtout le PSEUDO GITHUB, + l'acceptation
 * du CLA et de la confidentialité. Les réponses arrivent dans une feuille liée.
 */
function createContributorForm() {
  var form = FormApp.create('Jay Reach — Candidature contributeur')
    .setDescription(
      'Jay Reach est un moteur de prospection self-host, en dépôt privé sur invitation. ' +
      'Ce formulaire sert à candidater pour devenir contributeur. ' +
      'L\'accès au code est réservé aux personnes invitées et soumis à la signature ' +
      'du Contributor License Agreement (CLA) et d\'un accord de confidentialité.'
    )
    .setCollectEmail(true)        // email du candidat (compte Google)
    .setLimitOneResponsePerUser(false)
    .setProgressBar(true);

  form.addTextItem()
    .setTitle('Nom complet')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Pseudo GitHub')
    .setHelpText('Obligatoire : c\'est ce qui sert à t\'inviter sur le repo privé (ex. octocat).')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Email de contact (si différent de l\'email Google ci-dessus)')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Profil (LinkedIn, site, ou page GitHub)')
    .setRequired(false);

  var domaines = form.addCheckboxItem();
  domaines.setTitle('Domaines sur lesquels tu peux contribuer')
    .setChoiceValues([
      'Frontend (React / TypeScript)',
      'Backend (Supabase / Deno / SQL)',
      'Données / enrichissement / scraping',
      'DevOps / CI / self-host',
      'Design / UX',
      'Documentation',
      'Autre'
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Pourquoi veux-tu contribuer, et qu\'aimerais-tu apporter ?')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Disponibilité indicative')
    .setChoiceValues([
      'Moins de 2 h / semaine',
      '2 à 5 h / semaine',
      '5 à 10 h / semaine',
      'Plus de 10 h / semaine'
    ])
    .setRequired(false);

  form.addTextItem()
    .setTitle('Comment as-tu connu le projet ?')
    .setRequired(false);

  var engagements = form.addCheckboxItem();
  engagements.setTitle('Engagements (obligatoires)');
  var c1 = engagements.createChoice('J\'accepte de signer le Contributor License Agreement (CLA) avant tout merge.');
  var c2 = engagements.createChoice('J\'accepte de respecter la confidentialité du code (dépôt privé) tant qu\'il n\'est pas rendu public.');
  var c3 = engagements.createChoice('J\'ai compris que je ne pourrai pas pousser directement : tout passe par une Pull Request validée par l\'admin.');
  engagements.setChoices([c1, c2, c3])
    .setRequired(true);

  // Feuille de réponses liée (créée automatiquement)
  var ss = SpreadsheetApp.create('Jay Reach — Réponses candidatures contributeur');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('Formulaire (à partager) : ' + form.getPublishedUrl());
  Logger.log('Formulaire (édition)    : ' + form.getEditUrl());
  Logger.log('Feuille de réponses      : ' + ss.getUrl());
}

# 14. Guide opérateur

Ce guide s'adresse à la personne qui utilise Jay Reach au quotidien pour piloter sa prospection. Il décrit
ce que chaque écran fait, sans jargon technique et sans capture d'écran : les noms cités sont ceux qui
apparaissent réellement dans l'application.

## Les cinq entrées de l'application

Le menu de gauche donne accès à cinq entrées, toujours visibles :

- **Aujourd'hui** : l'écran d'ouverture, ce qu'il y a à traiter, ce qui part aujourd'hui, l'état du
  moteur, les plafonds du jour et la liste des campagnes.
- **Campagnes** : la liste de toutes les campagnes, et le bouton pour en créer une nouvelle.
- **Contacts** : tous les contacts trouvés par les sources, les entreprises, et les clients et exclusions.
- **Réception** : les fils de conversation avec les prospects, et la réponse depuis l'application.
- **Réglages** : sept pages pour régler l'application, Expéditeurs, Plafonds, Fournisseurs, Personas,
  Messages, Moteur, Compte.

En bas du menu, deux indicateurs restent visibles en permanence : l'état du moteur (en marche ou arrêté,
dernier et prochain passage) et les envois du jour. Le badge posé sur Réception compte les fils qui
attendent une réponse.

## Créer une campagne

Le bouton **Nouvelle campagne**, sur Aujourd'hui comme sur Campagnes, ouvre un assistant en quatre étapes.
Rien n'est enregistré avant le dernier bouton : vous pouvez revenir en arrière à tout moment.

1. **Qui** : donnez un nom à la campagne, choisissez le persona recherché (ou créez-en un nouveau), réglez
   le score minimal d'entrée si le défaut de l'organisation ne convient pas.
2. **Sources** : ajoutez au moins une source. Offres d'emploi (Adzuna, France Travail). LinkedIn
   (engageurs d'un post, abonnés d'un concurrent, mots-clés, changement de poste, réglables dès
   maintenant ; la collecte elle-même arrive dans un lot suivant). Ou manuel (fichier CSV, liste
   existante, annuaire d'entreprises).
3. **Séquence** : partez d'un modèle tout prêt ou composez vos étapes une par une : canal, objet, corps
   avec variables, délai avant la relance suivante.
4. **Envoi** : cochez les boîtes qui enverront, réglez le plafond quotidien de nouveaux contacts et, si
   vous le souhaitez, la relecture des premiers envois. Terminez par **Enregistrer en brouillon** ou
   **Créer et lancer**.

S'il manque quelque chose pour lancer (aucune boîte cochée, séquence vide, par exemple), l'assistant vous
le dit avant de créer la campagne plutôt qu'après.

## Suivre une campagne

Ouvrez une campagne pour retrouver ses sept onglets, sous un en-tête qui affiche son état et ses boîtes
d'envoi :

- **Vue d'ensemble** : l'entonnoir (trouvés, qualifiés, contacts identifiés, en séquence, livrés,
  réponses, intéressés), la file du jour, les plafonds du jour, les sources et les derniers événements.
- **Contacts** : tous les contacts de la campagne, avec leur état, leur score et leur étape ; cliquez un
  nom pour ouvrir sa fiche. Un contact **En pause** porte son motif (email jugé non délivrable, envoi
  refusé par le fournisseur d'email, aucune boîte d'envoi disponible, ou absence avec sa date de
  reprise) et un bouton **Reprendre** (**Reprendre maintenant** pour une absence), qui rejoue l'étape
  où il a buté ; pour un email jugé non délivrable, sa délivrabilité est revérifiée avant de repartir.
- **File du jour** : ce qui part aujourd'hui et ce qui est déjà parti, heure par heure. Rien n'attend
  votre accord, sauf les envois marqués « à relire » si la relecture est activée. Vous pouvez reporter un
  envoi au lendemain ou écarter le contact.
- **Sources** : les sources qui alimentent la campagne et leurs réglages ; ouvrez-en une pour lancer un
  passage tout de suite, sans attendre le prochain passage planifié.
- **Séquence** : les étapes de la campagne, leur objet, leur corps et leur délai. Le délai d'une étape se
  compte à partir de l'ENVOI RÉEL de l'étape précédente, jamais depuis sa mise en file : sur un lot volumineux
  réparti sur plusieurs jours d'envoi, un contact voit toujours ses étapes s'enchaîner dans l'ordre voulu,
  même si son tour arrive tard. Ajoutez ou modifiez une
  étape, et envoyez-vous un test avant de la publier. Si la campagne est alimentée par une liste
  importée, l'éditeur d'étape propose aussi les colonnes de cette liste en variables (« Colonnes de la
  liste importée ») : une variable de colonne que la campagne ne possède pas reste signalée manquante
  dans l'aperçu, pour ne pas laisser croire qu'elle partira renseignée.
- **Activité** : le journal de tout ce que le moteur a fait sur cette campagne, filtrable par type
  d'événement (sources, scoring, envois, réponses, erreurs).
- **Réglages** : nom, persona, score minimal, plafond quotidien, boîtes d'envoi, et le bouton pour
  archiver la campagne.

Le bouton **Lancer** ou **Mettre en pause** de l'en-tête agit sur la campagne entière.

## Traiter la Réception et répondre

La Réception affiche vos fils de conversation par filtre : **À traiter**, **Intéressés**, **Absences**,
**Traités**, **Toutes**. Un sélecteur (**Toutes les campagnes**) limite l'affichage à une seule
campagne si besoin.

Ouvrez un fil pour lire la conversation. La zone de réponse indique la boîte depuis laquelle vous
répondrez : le message part dans le même fil, par la boîte qui a écrit au contact. Répondre depuis
l'application n'existe que pour les fils email ; un fil LinkedIn se lit ici mais s'y répond ailleurs.
Envoyer une réponse sort déjà le fil de la liste À traiter, sans geste supplémentaire. Deux boutons
complètent la lecture : **Marquer intéressé** pose un drapeau et garde le fil visible sous Intéressés ;
**Marquer traité** fait la même chose à la main, pour un fil qu'on classe sans y répondre (vous pouvez
toujours le rouvrir).

La colonne de droite résume la fiche du contact, avec pourquoi lui, où en est-on, coordonnées et notes,
et un lien pour ouvrir la fiche complète.

## La fiche contact

Ouvrez la fiche d'un contact depuis n'importe quel tableau (Réception, Contacts, une campagne) en
cliquant son nom. Elle réunit :

- **Pourquoi lui** : la source ou le signal qui l'a fait remonter.
- **Où en est-on** : les étapes faites, en cours et à venir de sa séquence. Une séquence en pause
  affiche son motif et le bouton **Reprendre** (**Reprendre maintenant** pour une absence).
- **Ce qu'on s'est dit** : les messages échangés, avec un lien vers la Réception.
- **Coordonnées** : email, téléphone, LinkedIn.
- **Notes** : écrivez une note libre, horodatée, visible seulement dans la fiche.
- **Historique** : les événements qui concernent ce contact.

Depuis la même fiche, écartez le contact de la campagne ou passez-le en « ne plus contacter » : il sort
alors définitivement de toute prospection.

## Contacts, entreprises, clients et exclusions

La page Contacts réunit trois onglets : **Tous les contacts**, **Entreprises**, **Clients et exclusions**.

Filtrez par campagne, état, email ou source, recherchez un nom ou une entreprise, puis **Exporter** la
liste filtrée en CSV. Pour importer un fichier, cliquez **Importer un CSV** : choisissez la campagne de
destination, faites correspondre les colonnes du fichier aux champs de Jay Reach, puis vérifiez le compte
rendu (lignes lues, nouveaux contacts, déjà connus, sans email) avant de lancer l'import.

**Clients et exclusions** réunit deux blocs. **Clients Jay** : ajoutez un domaine client pour le signaler
dans vos résultats. **Ne plus contacter** : ajoutez une exclusion (email, domaine ou adresse LinkedIn) ;
un contact exclu ne sera plus jamais contacté.

## Les Réglages

Réglages regroupe sept pages, listées dans le menu de gauche de l'écran.

### Expéditeurs

Les **boîtes email** : une carte par boîte, avec son état de connexion, son usage du jour, sa cadence et
ses heures d'envoi. **Modifier** ajuste ces réglages ; **Relier une boîte** en connecte une nouvelle. Une
boîte peut aussi être réglée pour lire ses réponses directement, sans attendre la relève habituelle.

Les **comptes LinkedIn** : une carte par compte déjà connecté, avec ses quotas de profils lus et
d'actions par jour et par semaine, et le bouton **Modifier** pour les ajuster. Cet écran ne permet pas
encore d'en connecter un nouveau.

### Plafonds

Cette page règle ce qui protège l'organisation : le nombre de scorings et d'enrichissements autorisés par
jour, le score minimal d'entrée par défaut, la relecture des premiers envois par défaut, l'âge maximal des
offres retenues.

La règle à retenir : **tout se règle ici, en base**. L'environnement technique du serveur ne sert de repli
que si une ligne n'a jamais été réglée à l'écran. Ce que vous choisissez ici prime toujours. Un tableau
« Réglés ailleurs » rappelle les plafonds qui vivent au niveau d'une boîte, d'une campagne ou d'une source,
avec un lien direct vers le bon écran.

### Fournisseurs

Une carte par fournisseur branché : Anthropic (scoring), FullEnrich (enrichissement), SalesBlink (envoi
des emails), Microsoft 365 (relève directe des réponses), Adzuna et France Travail (offres d'emploi), et
les autres selon votre configuration. Chaque carte montre l'état de la clé, un bouton **Tester**, et la
consommation du jour quand elle se mesure.

### Personas

Qui vous cherchez : intitulés de poste reconnus, séniorité, consignes de notation lues par le modèle de
scoring, campagne par défaut. Le test d'appariement montre à quel persona un intitulé donné correspondrait.
Un persona ne se supprime pas : il s'archive, et disparaît alors du choix proposé pour une nouvelle
campagne, sans toucher aux contacts déjà liés.

### Messages

La bibliothèque des modèles réutilisables par canal. Modifier un modèle ici change toutes les campagnes
qui l'utilisent, à partir du prochain envoi.

### Moteur

L'état du moteur : en marche ou arrêté, dernier et prochain passage, dernière erreur, tâches en attente.

La **pause d'envoi globale** coupe tous les envois de toutes les campagnes, sans rien annuler : les
emails partiront quand vous la lèverez, et les sources, le scoring et la relève continuent de tourner
pendant la pause.

Vous pouvez lancer à la main, sans attendre le prochain passage planifié : un passage de toutes les
sources, un scoring des signaux en attente, ou un enrichissement des contacts sans email. La relève des
réponses, elle, tourne en continu côté serveur et ne se lance pas à la main.

### Compte

**Organisation** : nom, fuseau horaire (il fixe les heures affichées et les fenêtres d'envoi par défaut),
langue de l'interface.

**Membres** : invitez par email et suivez qui a accepté. Tant qu'une invitation est en attente, vous
pouvez la retirer ; un membre qui a déjà accepté ne se retire pas depuis cet écran, et son rôle ne s'y
modifie pas non plus.

**Mes notifications** : réglez si vous êtes prévenu à chaque réponse humaine reçue.

**Session** : le bouton **Se déconnecter** met fin à votre session.

## Ce que l'application ne fait pas encore

- Aucune suppression définitive : une campagne s'archive, une source se met en pause, un persona
  s'archive.
- Le mot de passe ne se change pas depuis l'application.
- Un membre déjà accepté ne se retire pas, et son rôle ne se modifie pas depuis l'écran Compte.
- Les préférences de notification ne couvrent que la réception d'une réponse.
- La cadence du moteur (fréquence des passages, fenêtre de relève) se règle par le serveur, pas par un
  écran.

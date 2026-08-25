# 12 — Backlog

Un ticket à la fois, dans l'ordre. Une PR par ticket. Chaque ticket se termine par : tests verts, documentation à jour, `CHANGELOG.md` complété.

**STOP** = validation humaine requise avant le ticket suivant. Sur tous les autres, en cas de doute : choisir l'option la plus conservatrice, écrire la question dans `QUESTIONS.md`, continuer.

---

## Jalon 0 — Audit et socle

### T0 — Audit du code existant · **STOP**
Suivre `docs/11-audit-legacy.md`. Produire `AUDIT.md` et `docs/legacy-assets/`. Ne rien modifier.

**Rappel : ce dépôt n'est pas vierge.** Une partie du code tourne en production sur la prospection réelle de l'éditeur. L'audit identifie ce qui doit continuer à tourner pendant la refonte, et propose pour chacun un chemin de migration derrière un drapeau de fonctionnalité. Aucune suppression avant validation humaine.

### T1 — Squelette du monorepo
pnpm workspaces : `apps/web` (Next.js 15, TS strict), `apps/worker`, `packages/{core,db,i18n,providers,ui}`. ESLint, Prettier, Vitest, CI GitHub Actions. `docker-compose.yml` avec Postgres et Supabase. `docker compose up` démarre une app vide qui répond.

### T2 — Schéma de base et RLS
Toutes les migrations de `docs/02-data-model.md`, y compris `lists`, `personas`, `message_templates`, `threads`, `contact_sender_bindings`, `customer_lists`, `notification_preferences`, `push_subscriptions`, `notifications`, et les champs `accounts.prospecting_opposition` / `accounts.is_customer`. Policies RLS sur chaque table. Types générés. Seed d'une organisation de démonstration en données fictives. Tests d'isolation inter-organisations.

### T3 — Authentification, organisations, rôles
Supabase Auth, création d'organisation, invitations, quatre rôles. Helper `requireRole()` testé.

### T4 — Internationalisation
`next-intl`, trois locales, `packages/i18n`. Sélecteur de langue, locale par défaut d'organisation. Aucune chaîne en dur : règle ESLint qui le vérifie.

### T5 — Coffre à credentials
Chiffrement `pgcrypto`. Écran de configuration généré depuis les manifests. Test de connexion par provider. Aucun secret renvoyé au client.

---

## Jalon 1 — Sources

### T6 — Contrats et registre de providers
Les sept interfaces de `docs/01-architecture.md`. Registre, chargement, validation des manifests. `pnpm reach:scaffold`.

### T7 — Runtime pg-boss
Les douze files. Idempotence, reprise avec temporisation exponentielle, arrêt propre. Écran d'administration des jobs.

### T8 — Résolution d'entreprise
Pipeline en quatre passes. File d'arbitrage. Tests sur cas difficiles : filiales, homonymes, sigles, accents.

Récupération de l'indicateur légal d'opposition au démarchage et création automatique d'une suppression de portée `account` quand il est actif. **Filtre non désactivable.** Motif affiché en clair sur le signal écarté.

### T9 — Import de fichiers
Parsers CSV et XLSX, détection d'encodage et de séparateur, mapping automatique multilingue, validation, déduplication par email puis LinkedIn puis nom+entreprise, compte rendu avant validation, création de liste avec `context_note` obligatoire, trois destinations. Règles de sécurité à l'import de `docs/03-sources.md`.

### T9b — Import des clients actuels
Voir `docs/03-sources.md`, partie C. Import CSV ou XLSX, exclusion **au niveau du compte** par SIREN puis domaine puis nom normalisé, arbitrage des correspondances floues, motif affiché en clair sur les signaux écartés, retrait d'une liste sans toucher aux désinscriptions réelles (champ `origin`), filtre dédié dans l'écran Signaux.

### T10 — Connecteur `jobboard`
France Travail principal, Adzuna complément. Exclusion des cabinets de recrutement. Déduplication multi-agrégateurs. Fixtures issues de T0.

### T11 — Personas
Table, écran de définition, `title_patterns` multilingues, correspondance à l'enrichissement, arbitrage en cas d'ambiguïté.

### T12 — Scoring
Règles puis modèle. Prompt éditable, versionné, tracé dans l'audit. Sortie JSON validée par Zod. Coût par appel affiché.

### T13 — Écran Signaux · **STOP**
Flux, filtres, états écarté / sans campagne / à arbitrer, détail, arbitrage. Premier écran avec le design system complet. Validation visuelle.

---

## Jalon 2 — Enrichissement

### T14 — Providers d'enrichissement
FullEnrich et Dropcontact pour les contacts, annuaire légal pour l'entreprise et les adresses d'établissement. Chaînage configurable, seuils de confiance, cache, budget par organisation, coût estimé avant exécution.

### T15 — Identification des contacts
Depuis un compte enrichi, trouver les personnes par persona. Correspondance des intitulés dans les trois langues, avec les variantes du terrain. Calcul de `contacts.locale`, y compris le cas belge.

### T16 — Écrans Prospects et Campagnes
Fiche entreprise, contacts avec photo et lien LinkedIn, signaux liés, tableau de séquence. Cartes de campagne avec les quatre chiffres.

---

## Jalon 3 — Séquenceur

### T17 — Cœur du séquenceur
State machine, inscriptions, boucle `tick`, ordonnancement, transitions, attribution et liaison des expéditeurs. Entièrement testé, sans aucun provider branché. **Ticket le plus important du projet.**

### T18 — Garde-fous
Les neuf garde-fous, avec décisions explicites `allow` / `defer` / `block`. Interrupteur d'arrêt global. Tests de charge sur les quotas.

### T19 — Messages, versions et variables
`message_templates` versionnés et multilingues. Validation statique des variables à l'enregistrement. Valeurs de repli. Blocage au rendu avec regroupement par champ manquant et actions groupées. Contraintes de longueur par canal. Traduction assistée relue.

### T20 — Canal email — Smartlead
`EmailProvider`, envoi, webhooks signés, conservation du fil, bounces et désinscriptions.

### T21 — Politique d'approbation et file d'attente · **STOP**
Réglage par canal, courrier non désactivable, rodage des trois premiers envois d'une version, dépassement de budget. Onglet de campagne, navigation clavier, édition en ligne.

### T22 — Canal LinkedIn
`LinkedInProvider`, implémentation Unipile, mode `manual` avec export. Garde-fous de pacing en dur. Avertissement à la connexion.

### T23 — Canal courrier — Manuscry
`MailProvider`, lead time, vérification humaine obligatoire de l'adresse au premier courrier vers une entreprise, sélection d'établissement, plafond de dépense, suivi impression et expédition.

### T23b — Canal téléphone
Étape `call` : tâche datée sans envoi, créée en `approved`, planifiée dans les heures ouvrées du contact. Écran de traitement avec le contexte complet (signal d'origine, historique d'envoi, consigne). Saisie du résultat et effets sur la séquence, dont le décalage complet en cas de rappel. Expiration à sept jours. `CrmProvider.pushTask()`.

### T23c — Notifications
Voir `docs/13-notifications.md`. Email transactionnel et notification bureau via Web Push (service worker, VAPID, manifest PWA). Demande d'autorisation déclenchée par un bouton explicite, jamais au chargement. Préférences par utilisateur et par événement. Groupement horaire et quotidien. Anti-avalanche. Repli temps réel dans l'interface quand le push n'est pas disponible.

L'email de réponse est le livrable central : objet sans préfixe, message reçu en entier, **motif du contact rappelé**, historique en une ligne, bouton unique.

### T24 — Éditeur de campagne
Étapes repliées avec résumé, modale d'édition de message, délai et condition entre étapes, règles d'entrée, entonnoir, versionnement. Trois campagnes livrées en exemple : signal emploi, signal nomination, liste importée.

---

## Jalon 4 — Réception et sortie

### T25 — Boîte de réception unifiée
`InboxProvider`, synchronisation bidirectionnelle, **filtre de correspondance obligatoire avec test explicite qu'un message sans rapport n'écrit rien**. Fils email et LinkedIn, réponse depuis Jay Reach par le sender lié, attribution à un membre.

### T26 — Classification des réponses
Trois passes : en-têtes, motifs multilingues en configuration, modèle en dernier recours. Effets sur les inscriptions : arrêt, pause avec reprise datée, départ d'entreprise. Badge d'absence avec remontée en tête de boîte le jour du retour. Suggestion de successeur.

### T27 — API publique et webhooks
REST `/api/v1`, clés d'API scopées et révocables, limitation de débit, OpenAPI généré. Webhooks sortants signés en HMAC avec réessais.

### T28 — Remontée CRM
`CrmProvider`, implémentations `jaycrm`, `webhook`, `csv_export`. Règle par défaut : push automatique sur réponse positive uniquement, manuel sinon, jamais de contact froid. Écran de configuration expliquant la règle.

### T29 — Connecteur `appointment`
Sources légales et presse en priorité. Sous-connecteur LinkedIn désactivé par défaut avec avertissement.

### T30 — Connecteur `tradeshow`
Listes d'exposants, `timing_mode` pré et post événement, signaux dans le futur.

### T31 — Conformité
Voir `docs/10-conformite.md`. Suppressions dont scope `postal`, purge, export et effacement d'une personne, registre de traitement, page d'information trilingue, avertissement Pays-Bas.

### T32 — Métriques
Par source, campagne, étape, sender. Coûts. Taux de réponse. **Délai médian signal → premier contact.** Aucun montant de pipeline.

---

## Jalon 5 — Exploitation et publication

### T33 — Exploitation self-hosted
Endpoint `/health` vérifiant base, worker et providers. Logs structurés en JSON sans coordonnées. Procédure de sauvegarde et de restauration documentée et testée. Guide de mise à jour.

### T34 — Import et export de séquences
Format JSON versionné pour partager une campagne complète — étapes, délais, conditions, messages dans les trois langues, sans données personnelles. C'est le vecteur de contribution le plus accessible, plus facile qu'écrire un connecteur.

### T35 — Expérience de première installation
Assistant de configuration, `.env.example` documenté, vérification de santé des providers, jeu de données de démonstration, choix de la langue dès le premier écran.

### T35b — Site vitrine et pages légales
Construire `jay-reach.fr` à partir de `maquettes/landing-jay-reach.html` : deux vues (offre hébergée, open source), sélecteur FR / EN / NL, et les trois pages légales de `maquettes/legal/`.

À compléter avant mise en ligne : greffe du RCS, numéro de TVA vérifié sur VIES, identité de l'hébergeur, téléphone. Traduction des pages légales en anglais et néerlandais. Recueil des trois témoignages clients — **aucune citation inventée**.

Note : la vue « offre hébergée » décrit un service qui n'est pas au périmètre de cette v1. Soit elle est mise en ligne avec un formulaire de liste d'attente, soit elle attend le jalon hébergé.

### T36 — Documentation publique
README, guide d'installation, guide « écrire un connecteur », guide « pousser vers un CRM », CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, licence, avertissements de conformité. Traduction anglaise du README.

### T37 — Sortie · **STOP**
Relecture de sécurité complète, purge de l'historique Git, rotation de tous les secrets, dépôt public.

**Bloquant :** le texte canonique de la FSL-1.1-ALv2 doit être récupéré sur fsl.software et placé dans un fichier `LICENSE` à la racine, avec le nom du licencieur et l'année. `LICENSE.md` n'est qu'un résumé. Tant que ce n'est pas fait, le dépôt ne devient pas public.

---

## Décidé, ne pas rouvrir

- **Nom** : Jay Reach.
- **Migration** de l'existant Smartlead : hors périmètre, pas de reprise de données.
- **Approbation** : par canal, courrier obligatoire, non désactivable.
- **CRM** : réponse positive uniquement en automatique.
- **Langues** : français, anglais, néerlandais dès le départ.
- **Mode entièrement automatique** sur tous canaux : n'existe pas en v1.
- **Domaine** : `jay-reach.fr`.
- **Périmètre v1 : self-hosted uniquement.** Ni facturation, ni abonnement, ni période d'essai, ni compteur de sièges, ni credentials mutualisés. L'offre hébergée est un jalon ultérieur.
- **Canal téléphone** : tâche datée poussée vers le CRM, sans téléphonie intégrée.
- **Exclusion des clients actuels** : au niveau du compte, pas du contact.
- **Opposition légale au démarchage** : filtre non désactivable.

## Jalon 6 — Offre hébergée (hors périmètre v1)

Listé ici pour mémoire, à ne pas commencer. Ce que le mode hébergé ajoutera :

- Credentials à deux niveaux : ceux de l'organisation en self-hosted, ceux de la plateforme en hébergé
- Facturation, plans, période d'essai sans carte, portail client, compteur de sièges
- Compteurs d'usage et plafonds mensuels appliqués, avec écran de consommation
- Assistant de première configuration à remonter en priorité — la promesse commerciale est « première campagne prête en dix minutes »
- Préchauffage de délivrabilité, page de statut, sauvegardes gérées

## À arbitrer plus tard

- Programme de contributeurs et commission d'affiliation : hors périmètre technique
- Quel CRM tiers natif en premier après Jay CRM
- Réservation de créneau dans les messages, test A/B des versions de templates

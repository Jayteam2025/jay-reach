# Questions ouvertes

Écrire ici toute situation non couverte par la documentation, avec la décision prise pour continuer.

Format :

## T<numéro> — <titre du ticket>

**Question.** Ce qui n'était pas décidé.
**Décision prise.** L'option la plus conservatrice retenue pour ne pas bloquer.
**Impact si l'arbitrage humain diffère.** Ce qu'il faudra reprendre.

---

## T1 — Squelette du monorepo

**Question 1.** Emplacement du nouveau monorepo vs le dépôt legacy (qui tourne en prod).
**Décision prise.** Nouveau dépôt **séparé** (`jay-reach-v2/`), le legacy reste intact comme référence à migrer derrière feature flags. Conforme à « ne jamais interrompre ce qui tourne ».
**Impact si l'arbitrage humain diffère.** Si migration in-place souhaitée, transplanter le contenu dans le dépôt legacy.

**Question 2.** Base de données locale : Postgres via `docker compose` (5432) OU pile Supabase via la CLI (`supabase start`, 54322) ?
**Décision prise.** Les deux, non exclusifs : `docker-compose.yml` lève un Postgres minimal ; `.env.example` documente le port Supabase CLI. Le câblage Supabase complet (Auth/Storage/Realtime) est traité en T2/T3.
**Impact si l'arbitrage humain diffère.** Aligner `DATABASE_URL` sur la source retenue.

**Question 3.** `docker compose up` (démarrage conteneurisé complet) n'a pas encore été exécuté ; seul le chemin local (`pnpm install` + build + `next start`) est vérifié.
**Décision prise.** Marqué à vérifier ; aucune affirmation de fonctionnement conteneurisé non testé.
**Impact si l'arbitrage humain diffère.** Lancer `docker compose up` et ajuster si besoin.

## T2 — Schéma de base et RLS

**Question 1.** Génération des types TypeScript (`Database`) : nécessite le CLI Supabase + une base locale lancée, indisponibles dans l'environnement d'édition.
**Décision prise.** Le type `Database` de `packages/db` reste un placeholder ; le script `pnpm --filter @jay-reach/db db:types` (`supabase gen types typescript --local`) est câblé pour régénérer dès que la stack Supabase locale tourne (T3).
**Impact si l'arbitrage humain diffère.** Lancer `supabase start` puis `db:types` pour obtenir les types réels.

**Question 2.** Nommage multi-tenant : la spec dit `organization_id` ; le legacy utilisait `workspace_id`.
**Décision prise.** On suit la spec — `organization_id` partout, tables `organizations`/`memberships`. La reprise du legacy se fera par renommage lors de la migration des données (hors T2).
**Impact si l'arbitrage humain diffère.** Renommage global si `workspace` est préféré.

**Question 3.** Rôles d'écriture par table (la spec définit owner/admin/operator/viewer sans détailler chaque table).
**Décision prise.** Lecture = membre (viewer+) partout ; écriture = **operator+** sur les tables opérationnelles (signaux, contacts, comptes, inscriptions, actions, threads, listes, suppressions, senders) et **admin+** sur la configuration (sources, personas, campagnes, templates, credentials, clients). `audit_events` append-only. Ajustable table par table.
**Impact si l'arbitrage humain diffère.** Modifier le seuil de rôle dans `20260817120100_rls.sql`.

## T3 — Authentification, organisations, rôles

**Question 1.** Le parcours d'auth complet (login réel, cookies, refresh de session) nécessite une instance Supabase lancée, indisponible dans l'environnement d'édition.
**Décision prise.** Vérifié ce qui est vérifiable sans stack : logique des rôles/`requireRole` (tests unitaires), build/typecheck du câblage SSR, et flux d'invitation côté base (RLS + RPC) sur Postgres 16. Le e2e login sera exercé une fois `supabase start` disponible (T35 / première install).
**Impact si l'arbitrage humain diffère.** Aucun — le câblage suit le pattern officiel `@supabase/ssr`.

**Question 2.** Exposition des RPC : PostgREST n'expose que le schéma `public`, or `create_organization`/`accept_invitation` vivent dans `app`.
**Décision prise.** Wrappers `public.*` (SECURITY DEFINER) qui délèguent aux fonctions `app.*` ; les helpers internes (`user_orgs`, `role_rank`) restent privés dans `app`.
**Impact si l'arbitrage humain diffère.** Si l'on préfère exposer le schéma `app`, retirer les wrappers et ajuster `config.toml`.

## T4 — Internationalisation

**Question 1.** Stratégie de locale : segment d'URL `[locale]` (SEO) ou cookie ?
**Décision prise.** **Cookie** (`NEXT_LOCALE`) sans routing d'URL — l'app est un back-office authentifié, pas un site indexé. Plus simple, garde les routes à plat. Le site vitrine (T35b), lui, aura ses locales dans l'URL.
**Impact si l'arbitrage humain diffère.** Passer au routing `[locale]` de next-intl si un besoin SEO/partage de liens localisés apparaît.

**Question 2.** Locale par défaut d'organisation (`organizations.default_locale`) : comment l'appliquer ?
**Décision prise.** Pour l'instant, fallback sur `defaultLocale` (fr) si aucun cookie. Le câblage « initialiser le cookie sur la locale de l'org à la connexion » se fait avec le layout org-scoped (arrive avec les écrans, T13/T16).
**Impact si l'arbitrage humain diffère.** Lire `default_locale` de l'org courante dans `i18n/request.ts` une fois le contexte org disponible.

## T5 — Coffre à credentials

**Question 1.** Gestion de la clé de chiffrement.
**Décision prise.** Une clé symétrique unique `ENCRYPTION_KEY` (env serveur), `pgp_sym_encrypt/decrypt` (pgcrypto). Pas de rotation ni de versioning de clé en v1 (comme le legacy) — à documenter comme limite ; rotation prévisible plus tard.
**Impact si l'arbitrage humain diffère.** Ajouter un identifiant de clé au chiffré + procédure de rotation.

**Question 2.** L'écran `/settings/providers` a besoin de l'organisation courante, or le sélecteur d'org n'existe pas encore.
**Décision prise.** L'écran prend la **première adhésion** de l'utilisateur en attendant le sélecteur (arrive avec les écrans applicatifs). Il ne lit jamais le secret : seule la vue `credentials_public` (statut + last4).
**Impact si l'arbitrage humain diffère.** Brancher l'org courante quand le sélecteur existe.

**Question 3.** Test de connexion par provider.
**Décision prise.** Interface + action serveur en place, mais le test réel (appel API) arrive avec chaque provider (T20 Smartlead, T22 LinkedIn…). Pour l'instant, il valide que le provider est connu.
**Impact si l'arbitrage humain diffère.** Implémenter `testConnection` dans chaque manifest de provider.

## T6 — Contrats et registre de providers

**Question 1.** Disposition des providers : l'architecture décrit `packages/providers/<catégorie>/<id>/` ; on a d'abord un package unique `@jay-reach/providers`.
**Décision prise.** Un seul package pour l'instant, avec un sous-dossier `src/providers/<id>/` généré par `reach:scaffold`. Découpage en sous-packages possible plus tard sans changer les contrats.
**Impact si l'arbitrage humain diffère.** Éclater en sous-packages si le nombre de providers le justifie.

**Question 2.** `configSchema` Zod de configuration runtime d'un provider (au-delà des champs de credentials) : le manifest expose `fields` (credentials) ; le schéma de config fonctionnelle (mots-clés, zone géo…) arrivera avec chaque connecteur.
**Décision prise.** Manifest = catégorie + libellé + champs de credentials en T6. La config fonctionnelle par source vit déjà dans `sources.config` (jsonb) et sera validée par le manifest du connecteur (T10+).
**Impact si l'arbitrage humain diffère.** Ajouter un `configSchema` au manifest quand les connecteurs le nécessitent.

## T7 — Runtime pg-boss

**Question 1.** Écran d'admin des jobs : compteurs en temps réel ? pg-boss stocke ses jobs dans le schéma `pgboss`, non exposé par PostgREST.
**Décision prise.** L'écran liste les 12 files et leur politique de reprise (source de vérité `@jay-reach/core`). Les compteurs live (par état) nécessitent un endpoint côté worker ou une vue sur `pgboss.job` — ajouté quand l'exploitation le demande (T33).
**Impact si l'arbitrage humain diffère.** Exposer une vue/endpoint de stats et brancher l'écran dessus.

**Question 2.** Build du worker : `tsc` posait un conflit de `rootDir` en important `@jay-reach/core` (sources).
**Décision prise.** Worker bundlé via **esbuild** (`dist/index.js` autonome), typecheck toujours via `tsc --noEmit`. Les packages-librairies restent en `tsc`.
**Impact si l'arbitrage humain diffère.** Passer aux références de projet TypeScript si un build 100 % tsc est souhaité.

## T8 — Résolution d'entreprise

**Question 1.** Passe 2 (annuaire légal) : l'appel réel à `recherche-entreprises.api.gouv.fr` (SIREN/NAF/adresses/opposition).
**Décision prise.** La logique de résolution est pure avec des accès injectés (testable) ; l'implémentation HTTP de l'annuaire légal arrive comme provider d'enrichissement (T14) en réutilisant les paramètres extraits dans `docs/legacy-assets/enrichissement.md`. L'indicateur d'opposition sera lu à ce moment et posé sur `accounts.prospecting_opposition` (le trigger fait le reste).
**Impact si l'arbitrage humain diffère.** Aucun — le contrat `byLegalRegistry` est déjà défini.

**Question 2.** File d'arbitrage des comptes `unresolved`.
**Décision prise.** Colonne + index en place ; l'écran d'arbitrage se fait avec l'écran Signaux (T13) où les non-résolus remontent.
**Impact si l'arbitrage humain diffère.** Écran d'arbitrage dédié si besoin.

## T9 — Import de fichiers

**Question 1.** XLSX et détection d'encodage (UTF-8/Latin-1) : nécessitent un lecteur binaire.
**Décision prise.** Le **moteur pur** (parsing CSV, mapping, validation, dédup, rapport) est en place et testé. Le lecteur XLSX + la détection d'encodage se branchent à l'upload côté web (lib maintenue), en produisant le même `ParsedRows` que le moteur consomme.
**Impact si l'arbitrage humain diffère.** Aucun — l'interface `ParsedRows` est stable.

**Question 2.** Parcours d'import (upload UI, 3 destinations, règles de sécurité à l'import — suppression/clients/déjà-en-séquence).
**Décision prise.** Le cœur de traitement est prêt ; l'écran d'upload et l'application des règles de sécurité s'appuient sur le worker (file `imports.process`) et le moteur d'inscription (T17). `context_note` est déjà obligatoire au niveau du schéma (T2).
**Impact si l'arbitrage humain diffère.** Câbler l'écran + le worker d'import quand l'inscription existe.

## T9b — Import des clients actuels

**Question.** Alimentation (fichier vs synchronisation CRM) et remplissage de `customer_list_entries`.
**Décision prise.** Le mécanisme d'exclusion (match compte + trigger + retrait sélectif) est en base et vérifié. Le remplissage des entrées réutilise le moteur d'import (T9) pour le mode fichier ; la synchronisation CRM passera par `CrmProvider` (T28).
**Impact si l'arbitrage humain diffère.** Aucun — le contrat de matching (`match_customer_account`) est stable.

## T10 — Connecteur jobboard

**Question.** Le `discover()` HTTP (OAuth France Travail, pagination Adzuna) et sa planification.
**Décision prise.** La partie PURE (normalisation, exclusion cabinets, dédup) — celle qui casse quand la source change — est en place et testée sur fixtures synthétiques. L'appel réseau + OAuth se branchent dans le worker (file `sources.discover`) en réutilisant les paramètres d'API de `docs/legacy-assets/signaux-scrapers.md`. Fixtures **anonymisées** (aucune vraie entreprise).
**Impact si l'arbitrage humain diffère.** Aucun — `normalize` est stable et testé.

## T13 — Écran Signaux (STOP)

**Question 1.** L'écran affiche des **données représentatives** (fictives) car le pipeline (worker) n'est pas encore branché ; il n'est pas non plus gardé par l'auth pour permettre la revue visuelle.
**Décision prise.** Écran complet avec le design system ; données de démo clairement isolées dans `lib/sample-signals.ts`. Le branchement aux vrais signaux + le `requireUser` se font quand le worker de collecte tourne.
**Impact si l'arbitrage humain diffère.** Remplacer la source de données par la requête réelle et remettre `requireUser`.

**Question 2.** Boutons Valider / Écarter : pour l'instant présentés (visuel), l'action réelle (transition de statut du signal) se branche avec l'écran connecté aux vraies données.
**Décision prise.** Structure en place ; action serveur à câbler.
**Impact si l'arbitrage humain diffère.** Ajouter l'action serveur de transition.

## T22 — Canal LinkedIn (invitations + messages)

**Question 1.** La spec prévoit **Unipile** comme fournisseur LinkedIn. Or (a) Unipile est un service tiers payant à intégrer, et (b) l'API officielle LinkedIn de messagerie n'est pas accessible sans partenariat. Le collègue **JB** a déjà une solution qui tourne côté produit *Jay* : une **extension Chrome** qui envoie les **invitations** via l'API interne **Voyager** de LinkedIn (session de l'utilisateur), avec pacing serveur.
**Décision prise.** On **reprend l'approche extension JB** pour Jay Reach : invitations via Voyager (`verifyQuotaAndCreateV2`), et **messages/DM en net-new** par la même technique Voyager (`voyagerMessagingDashMessengerMessages?action=createMessage`). Une seule file généralisée `linkedin_action_queue` (`kind` = invite|message), pacing appliqué **côté serveur** (fenêtre 08–21 h Paris, plafond dur 200/7 j, intervalle 1–20 min déterministe, requeue 10 min), et un **curseur** par organisation (`linkedin_settings` : mode auto/hybride/manuel + volume/jour). Phase 1 (backend file + pacing + endpoints extension) construite et **vérifiée hermétiquement** (`test/pg-verify/linkedin-queue.sh`, données fictives, **aucun envoi réel**).
**Impact si l'arbitrage humain diffère.** Si Unipile est imposé : remplacer l'extension par un `LinkedInProvider` appelant Unipile ; la file et le curseur restent valables (on change juste l'exécuteur d'envoi). Le pacing serveur reste utile quel que soit le canal.

**Question 2.** Automatisation LinkedIn = contraire aux CGU LinkedIn ; risque de restriction de compte.
**Décision prise.** Envoi via la **propre session** de l'utilisateur (comme JB côté *Jay*), plafonds prudents, pauses automatiques (24 h sur `restricted`/`not_logged_in`), et **avertissement CGU obligatoire** à la connexion (Phase 3). **Aucun envoi réel** n'est déclenché sans un vrai compte connecté **et** le go du boss (STOP séquenceur, Phase 4).
**Impact si l'arbitrage humain diffère.** Si le boss refuse l'automatisation, ne garder que le **mode manuel** (file « à faire à la main ») — déjà prévu par le curseur.

**Mise à jour (2026-08-20) — accord boss obtenu.** Le STOP est levé pour LinkedIn. Phase 4 câblée : `actions.dispatch` route le canal LinkedIn vers `linkedin_action_queue` (au lieu d'un appel API). **Dépendance restante** : la file `sequence.tick` qui PRODUIT les jobs `actions.dispatch` est encore un no-op (ticket séquenceur T17/T18) ; tant qu'elle n'émet pas de jobs LinkedIn, l'auto-envoi de bout en bout n'a pas lieu. Un envoi effectif requiert aussi une **extension connectée à un vrai compte**. La chaîne dispatch→file→extension est prouvée hermétiquement (données fictives).

## Séquenceur — câblage `sequence.enroll` / `sequence.tick` (T17/T18, MVP)

**Contexte.** Le cœur du séquenceur (machine à états, quotas, gardes, planification, liaison expéditeur) existait en fonctions **pures** mais n'était branché à rien (files no-op). Câblé pour rendre l'auto-envoi LinkedIn effectif de bout en bout : `sequence.enroll` (inscription + dédup une active/contact), `sequence.tick` (avance les inscriptions dues, émet des actions idempotentes, enfile les envois LinkedIn autorisés vers `actions.dispatch`). Décision par étape isolée dans une fonction pure testée (`composeTick`).

**Simplifications assumées (MVP), à compléter par ticket dédié.**
1. **Planification.** L'action de l'étape due est planifiée à `now` (immédiat) ; le décalage fenêtre ouvrée (`shiftIntoBusinessHours`), le jitter et les quotas d'expéditeur (`allocateWithinQuota`) ne sont pas encore appliqués dans le tick (helpers purs prêts). Le pacing LinkedIn reste, lui, appliqué en aval (file + serveur).
2. **Liaison expéditeur.** `resolveSender` n'est pas encore invoqué par le tick (l'envoi LinkedIn passe par la session de l'utilisateur, pas par un `sender`). `actions.sender_id` reste nul pour l'instant.
3. **Approbation.** File d'attente humaine (`pending_approval`) déclenchée si : canal `letter`, mode LinkedIn `manual` (curseur), ou `approval_policy` de la campagne (`mode:'all'` ou `channels:[…]`). Le budget courrier (`letter_monthly_budget_eur`) et l'écran de validation ne sont pas encore câblés.
4. **Canaux dispatchés.** Seuls `email` (Smartlead, existant) et `linkedin_invite`/`linkedin_message` sont routés. Le tick **émet** aussi les actions `letter`/`call` mais aucun envoi aval n'existe encore pour elles. L'email : l'action est émise mais le tick n'enfile pas encore de job Smartlead (mapping campagne→id Smartlead + assemblage des leads = ticket dédié).
5. **Rendu des variables.** Le corps du message LinkedIn est pris tel quel dans le template ; la résolution des variables (`unresolvedVariables` de `runGuards`) n'est pas encore appliquée.
6. **Réconciliation des résultats.** L'action reste en `scheduled` ; l'état d'envoi réel vit dans `linkedin_action_queue`. Le rapprochement `outcomes`/`actions` (ouvert/répondu/accepté) est un ticket séparé.

**Vérifié.** `test/pg-verify/sequence-tick.sh` (inscription → tick → action idempotente → dispatch → `linkedin_action_queue`, suppression → arrêt) + `composeTick` (unitaire). Aucun envoi réel : les lignes restent en `pending` jusqu'à une extension connectée à un vrai compte.

## Résolu — Canal téléphone

Spécifié dans `docs/02-data-model.md`, `docs/04-sequenceur.md` et le ticket T23b. Plus rien à arbitrer.

## Résolu — Notifications

Spécifié dans `docs/13-notifications.md` et le ticket T23c.

## Ouverte — Écran « Branding / Identité »

Le boss (via l'utilisateur) demande un onglet **Branding** (repris de la sidebar legacy). Aucune fonctionnalité de branding n'est définie dans le backlog ni les docs (`grep branding` = 0). CLAUDE.md : « Ne pas inventer de fonctionnalité absente du backlog ».

**Décision (conservatrice)** : écran ajouté en **aperçu local uniquement** (`apps/web/app/settings/branding/`), aucun schéma, aucune écriture, aucun secret. Champs : nom d'expéditeur, email de réponse, signature email, signature manuscrite (courrier), couleur d'accent, logo. À spécifier (contenu réel, persistance) et rattacher à un ticket avant toute mise en base.

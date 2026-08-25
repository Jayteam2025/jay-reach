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

**Mise à jour (2026-08-24) — validé en conditions réelles par JB (retour PR).** JB a testé les deux canaux avec un vrai compte :
- **Invitations** : `linkedin-invite.js` fonctionne tel quel (`verifyQuotaAndCreateV2` → HTTP 200 + `invitationUrn`). Rien à changer.
- **Messages** : le module échouait en **HTTP 400 muet** (`originToken` absent, `trackingId` vide). **Corrigé** dans `apps/extension/linkedin-message.js` : `originToken: crypto.randomUUID()` ajouté **dans** `message` (pas à la racine, sinon 400) et `trackingId` = 16 octets bruts (pas base64). Avec ça : HTTP 200, message délivré. La prospection à froid (1er contact sans fil préalable, via `hostRecipientUrns`) est confirmée : LinkedIn crée le thread à partir du destinataire.
- **Durcissement** (aussi appliqué) : `getSelfProfileUrn()` ne retient plus le premier `fsd_profile` de `included[]` mais celui dont le `publicIdentifier` correspond au nôtre (fallback conservé si vanity inconnu, pour ne pas casser `/me`).

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

## Résolu — Projet Supabase hébergé [demande #1 de JB, 2026-08-25]

Un **projet Supabase hébergé dédié au v2** est en place (`ywlvazimwuoiykhnhatl`, org `Jay-Reach`, région eu-west-3), **distinct de la base v1 en prod** (`jstcgfgwaeesrqztsvhe`, schéma `workspaces/prospect_*` — jamais touchée). Les 11 migrations sont appliquées, les **types régénérés** (`packages/db/src/database.types.ts`), le seed appliqué (org « Atelier Démo SAS », user `demo@atelier-demo.test`). **Auth + RLS vérifiés pour de vrai** : un membre voit les données de son org (5 signaux), l'anon en voit 0. Les trois « pas vérifiable sans Supabase » du présent fichier sont donc **levés**. Secrets uniquement dans `apps/web/.env.local` (gitignoré). Connexion via le pooler `aws-1-eu-west-3.pooler.supabase.com` (l'hôte direct `db.<ref>` ne résout pas partout).

## Résolu — Blacklist complète des cabinets [demande #3 de JB, 2026-08-25]

**Constat de JB.** `signal-filters.ts` n'avait que 35 noms « extraits de la blacklist legacy », alors que le v1 en a 200+ en base, auto-apprises.

**Décision prise.** Reprise **fidèle au v1**, qui avait précisément SORTI la liste du code (« remplace la liste hardcodee ») pour une table auto-apprenante — on ne ré-inscrit donc pas 200 noms en dur.
- **Migration** `20260825120000_recruitment_blacklist.sql` : table `recruitment_agencies_blacklist` + fonction `normalize_agency_name` + RLS + **seed des 200 noms** (201 uniques par affichage, 200 après normalisation — une paire fusionne, comme la contrainte unique du v1).
- **Multi-tenant (choix conservateur, règle CLAUDE.md #5)** : `organization_id` NULLABLE. **NULL = seed global partagé** (comme le v1) ; **non-NULL = entrée apprise/ajoutée par une org**. La RLS laisse tout membre lire le global + ses entrées. Divergence assumée avec le v1 (table globale sans tenant) : imposée par la RLS multi-tenant du v2.
- **Filtre** (`signal-filters.ts`, pur) : `isRecruitmentByName(name, blacklist?)` combine le motif générique + la blacklist DB (noms normalisés) + un repli intégré hors-DB. `normalizeAgencyName` reproduit à l'identique la fonction SQL (vérifié : `adecco`, `mercatodelemploi`, `orientaction`). **L'exclusion par code NAF (division 78) reste** — la liste la complète.
- **Auto-apprentissage** (`apps/worker/src/blacklist.ts`) : `loadRecruitmentBlacklist(org)` (global+org) et `learnRecruitmentAgency(org, nom)` (INSERT `source='auto_score'`, incrément `detected_count` sur ré-occurrence). Testé en réel contre la base (chargement 200, apprentissage org-scoped, incrément à 2, nettoyé).

**Reste à câbler (parité T12).** L'INSERT d'auto-apprentissage doit être appelé par le scoring quand le modèle juge une entreprise cabinet/intermédiaire (score 0 + motif). Le point d'appel est prêt (`learnRecruitmentAgency`) ; il sera invoqué au moment où le worker persiste le scoring (complétion de T12), qui n'est pas encore branché.

**Correction (2026-08-25) — collision de nom avec le schéma v1 [retour de JB].** La table `recruitment_agencies_blacklist` existe DÉJÀ dans le schéma actuel, avec une AUTRE structure (sans `organization_id`). Sur une base vierge on ne le voyait pas ; sur toute instance existante, `create table if not exists` était un no-op et le reste de la migration référençait une colonne absente → **échec**. Corrigé : ajout explicite `alter table … add column if not exists organization_id …` (no-op sur base v2 fraîche, ajoute la colonne sur base v1) + policies `drop … if exists` pour l'idempotence. **Vérifié en réel** : migration rejouée sur une table de structure v1 (transaction annulée sur la base hébergée) → OK, idempotente, lignes v1 conservées (org NULL), déduplication correcte.

## Décidé — Clé de déduplication des entreprises (scission `prospect_profiles` → `accounts` + `contacts`) [tranché 2026-08-25]

**Contexte.** Le v1 fusionne entreprise + contact sur une seule ligne (`prospect_profiles`). La cible sépare `accounts` (entreprise) et `contacts` (personne). Il faut donc regrouper les lignes v1 par entreprise. Sur l'instance de référence de JB : **55 lignes ≈ 20 comptes réels**. Trois clés possibles : SIREN, domaine, `company_group_id`.

**Ce que révèlent les deux schémas :**
- **v1** `prospect_profiles` porte déjà : `company_group_id` (uuid), `company_siren`, `domain` (+ `domain_source`), `company_name`. Le v1 a une logique de « companies virtuelles » : **`company_group_id` regroupe déjà les profils en entreprises** — c'est ce regroupement que l'opérateur voit (les ~20 comptes). `prospect_actions` est même clé par `company_group_id`.
- **v2** `accounts` : `siren` et `domain` sont des attributs avec index UNIQUE par organisation (`(org, siren) where siren not null`, `(org, domain) where domain not null`) + recherche trigram sur `name`.

**Décision (validée 2026-08-25).** Clé primaire de regroupement = **`company_group_id`**, pas SIREN ni domaine.
- *Pourquoi* : c'est la **déduplication déjà accumulée à l'usage** (CLAUDE.md #3 : « toute connaissance encodée dans l'existant est un actif »). Elle reproduit exactement le nombre de comptes que l'opérateur connaît (~20), au lieu d'en re-dériver un autre. SIREN est souvent NULL (prospects non résolus/étrangers) → regrouperait différemment ; le domaine est partagé entre entités ou absent → moins fiable.
- *SIREN et domaine deviennent des attributs du compte* (et alimentent les index UNIQUE v2). Si deux `company_group_id` résolvent le même SIREN → conflit à réconcilier (à **logger**, pas fusionner silencieusement).
- *Repli* pour les lignes sans `company_group_id` : SIREN, puis domaine, puis **ligne isolée** (conservateur — ne jamais sur-fusionner).

Le code de migration vient plus tard (après parité, cf. issue #17) ; cette décision fige le modèle dès maintenant.

## Décidé — Périmètre de parité pour la bascule [confirmé 2026-08-25]

Périmètre minimal pour que le v2 remplace le v1 = **Jalons 0 + 1 + 2, + T19, + T20**, **plus** :
- **T24** (éditeur de campagne) — l'édition des templates/séquences en application fait partie de la parité (T16 ne donne que les écrans en lecture).
- **Volet webhooks de T27** — réception des webhooks Smartlead (le reste de T27, API publique, reste hors parité).

Et deux compléments **dans** la plage, cadrés mais pas finis : l'**auto-apprentissage de la blacklist** (T12) et le **mapping campagne→Smartlead + enfilage depuis le tick** (T20). Le reste (LinkedIn, courrier, téléphone, boîte de réception complète, API publique) reste hors critère de bascule.

## Résolu — Scoring LLM des signaux + auto-apprentissage blacklist (T12) [2026-08-25]

Le pipeline avait `discover → qualify (INSEE)` mais **aucun scoring LLM** ni consommation de la blacklist. Comblé : nouvelle file `signals.score` + handler `apps/worker/src/handlers/score.ts` (`runScore`).

**Étapes** : (1) pré-filtre bon marché — cabinets (blacklist DB + NAF division 78) → `discarded/recruitment_agency`, signaux périmés (fenêtre 30 j) → `discarded/stale` ; (2) scoring LLM des survivants **groupés par source** (chaque source impose son prompt et son seuil) ; (3) persistance `signals.score/score_reason/scored_at/status` (≥ seuil → `qualified`, sinon `discarded/low_score`) ; (4) **auto-apprentissage** : score 0 + motif « cabinet » (`isCabinetVerdict`) → `learnRecruitmentAgency` (blacklist de l'org) + `discarded/recruitment_agency`.

**Arbitrage — où vivent le prompt et le seuil de scoring ? [révisé 2026-08-25 après review #19]**

Première version : prompt = première persona active (`personas.scoring_prompt`), seuil = 60 en dur. Review JB : erreur de parité. Le socle actuel scorait **par déclencheur** (`signal_triggers.signal_scoring_prompt` + `signal_match_threshold`) — le prompt qualifie **le signal** (« cette boîte m'intéresse-t-elle ? »), pas la persona (« qui contacter ? »). Et `order by created_at asc` faisait qu'une seule persona imposait son prompt à tous.

Le schéma cible (`docs/02-data-model.md`, qui fait foi) **n'a pas** de table `signal_triggers` (artefact v1) mais **a** `sources.config` (jsonb). **Décision (option A, validée)** : ranger `scoring_prompt` + `match_threshold` dans **`sources.config`**. Le handler charge la source de chaque signal (`signals.source_id`) et score groupé par source, chacune avec son prompt et son seuil. Pas de nouvelle table. Une source sans prompt exploitable (≥ 200 car.) n'est pas scorée : ses signaux restent `new`. Le seuil de la source prime ; à défaut, repli sur le défaut org (60).

**Nuance actée [2e review #19]** : « un déclencheur v1 = une source v2 » est **inexact** — un déclencheur v1 porte `source_types text[]` (relation un-vers-plusieurs : un prompt/seuil pour Adzuna ET France Travail). Le choix reste viable (`sources` n'a pas d'unicité `(org, provider)`, on peut créer 2 sources Adzuna avec des prompts distincts), **au prix d'une duplication** : le même prompt/seuil doit être copié dans chaque `sources.config`, sans garde-fou contre la divergence, et l'opérateur perd le regroupement « même besoin métier ». La migration v1→v2 (#17) devra éclater chaque déclencheur en N sources en dupliquant sa config. **Arbitrage assumé** : on garde l'option A (conforme à la spec, pas de table hors-modèle) ; à rouvrir si le besoin de regroupement/factorisation se confirme.

**Modèle — reprise fidèle du socle [2e review #19]** :
- **Système de niveaux `fast` / `smart`** (`SCORING_MODELS` dans `@jay-reach/core`), pas un modèle unique en dur. Le scoring tourne en **`smart` → `claude-sonnet-5`** (seul changement vs socle : `sonnet-4-6` → `sonnet-5`). `fast` = `claude-haiku-4-5`. Ni Opus ni Fable (Fable 5 est le **plus cher** du catalogue, 5× Sonnet).
- **Override par organisation, en base** : `resolveScoringModel('smart', config)` lit `config.model_smart` / `config.model_fast` de la **config du provider Anthropic** (champs ajoutés au catalogue, éditables dans l'écran Providers). **Pas de variable d'env** (`SCORING_MODEL` retiré) : elle serait globale au worker, non réglable par instance.
- **`thinking: { type: 'disabled' }`** explicite : sur Sonnet 5, omettre `thinking` active le raisonnement adaptatif (nouveau défaut) — tokens facturés, latence, et surtout ponction du budget `max_tokens`. On garde le comportement du socle (pas de raisonnement pour de la classification).

**Budget de sortie (point BLOQUANT #19, corrigé)** : `max_tokens` était figé à 2000 → un lot de 50 objets `{id,score,reason}` (~2500 tokens) tronquait le JSON → `JSON.parse` échoue → **lot entier perdu**. Corrigé : `scoringMaxTokens(n)` (`@jay-reach/core`) = `max(2048, n*200 + 512)`, dimensionné sur le lot. Testé en unitaire (le harnais à 6 signaux ne pouvait pas le voir).

**Autres décisions** :
- **Fenêtre de fraîcheur** = 30 j. **Lot** = 50 signaux/job.
- **Chaînage** : producteur périodique `enqueueScoringForOrgs` (un `signals.score` par org ayant des signaux `new`/non scorés, idempotent par fenêtre). Le déclenchement fin (juste après qualify, par signal) reste un raffinement.

**Vérifié** : `bash test/pg-verify/scoring.sh` (base locale jr_dev, scorer déterministe, zéro appel LLM) → Adecco (blacklist) écarté, PME périmée écartée, Super PME qualifiée (82 ≥ **seuil source 70**), Moyenne PME écartée par **le seuil de la source** (65 < 70), Cabinet Louche (score 0 + verdict) **auto-appris** + écarté, signal d'une **source sans prompt** laissé `new`, et **lot plein de 45 signaux** tous scorés/qualifiés (aucun perdu). + tests unitaires `resolveScoringModel`, `scoringMaxTokens`, `isCabinetVerdict`, `meetsScoreThreshold`.

## Résolu — Éditeur de messages versionné et multilingue (T19, partie éditeur) [2026-08-25]

Suite de la partie moteur : l'écran d'édition. La partie moteur avait laissé de côté l'UI, le retour arrière de version (colonne absente) et l'unification avec `guards.ts`.

**Schéma** : migration `message_templates.is_active` — au plus une version active par (lignée, langue), via un index d'unicité partiel sur `(coalesce(parent_id,id), locale) where is_active`. Rétro-compatible (défaut `true` + dédup de sécurité avant l'index). La lignée = `parent_id`, ou l'`id` de la racine.

**RPC atomiques** (schéma `app` + wrappers `public` appelés par les server actions) :
- `save_message_template_version(org, family, name, channel, locale, subject, body)` : crée une nouvelle lignée (family null) ou ajoute une version à la (lignée, langue) — numérote, **désactive l'active courante, insère la nouvelle active**. Contrôle `admin` explicite (SECURITY DEFINER).
- `activate_message_template_version(id)` : **retour arrière** — réactive une version antérieure, désactive l'autre active.

**Server actions** `apps/web/app/actions/templates.ts` : `saveTemplateVersion` valide d'abord les variables (`validateTemplateVariables`, refus à l'enregistrement) puis appelle la RPC ; `activateTemplateVersion` pour le retour arrière. Pattern du repo (`requireRole('admin')`, retour `{ok}`/`{error}`, `revalidatePath`).

**Écran** `/settings/templates` (+ entrée de nav « Messages ») : liste des lignées (canal, langues, nb versions) ; éditeur en modale avec onglets FR/EN/NL (indicateur ●/○), toggles canal + nature, validation des variables **en direct**, compteur de mots vs plafond du canal, chips de variables insérables (filtrées par nature), et **historique des versions** avec bouton **Réactiver**. Réutilise le design `rs-*` (aucune nouvelle classe CSS) et le pattern `useTransition` + `router.refresh()`. i18n FR/EN/NL.

**Effet sur l'envoi** : le tick résout maintenant la **version active** (`resolveTemplate` filtre `is_active`) — le retour arrière prend donc effet au prochain envoi. Rétro-compatible : sur les lignées existantes, la plus récente est active.

**Décisions / périmètre** :
- **Nature de campagne** (signal/liste) choisie dans l'éditeur pour piloter la validation — non persistée sur le template (un template reste réutilisable ; sa nature effective dépend de la campagne qui l'emploie).
- **Enregistrement par langue** : « Enregistrer » crée une version pour la **langue de l'onglet courant** (une version = une (lignée, langue)). L'opérateur bascule d'onglet et enregistre chaque langue.
- **Non fait** (raffinements) : le `sent_count` remis à zéro à la création de version (spec §11 — le rodage repart) n'est pas encore câblé côté RPC ; le **taux de réponse par version** dans l'historique (données pas encore agrégées) ; la **traduction assistée relue** ; l'UI de **regroupement des actions bloquées par champ manquant** (les données sont là : `actions.block_reason='missing_variable'` + `payload.missingVariables`). Le `guards.ts` porte toujours une logique `unresolvedVariables` parallèle non branchée — à retirer/unifier.

**Vérifié** : `bash test/pg-verify/templates.sh` (contexte auth réel, zéro envoi) → création de lignée + versions (seule la dernière active), **retour arrière** (réactive la v1), **indépendance des langues** (une active par langue), **unicité** (deux actives même lignée+langue → 23505). + build web (`/settings/templates`), typecheck, lint, 148 tests unitaires.

## Résolu — Moteur de variables des messages + blocage (T19, partie moteur) [2026-08-25]

Le schéma `message_templates` était versionné/multilingue, mais **aucune logique de variables** n'existait : ni extraction, ni validation, ni rendu. Le garde-fou `unresolvedVariables` (guards.ts) existait mais **n'était branché nulle part**, et le worker chargeait le corps LinkedIn sans filtrer la langue ni substituer les `{{champ}}` (un `{{prenom}}` serait parti littéral — violation de la règle CLAUDE.md #2).

**Construit** : module pur `@jay-reach/core/messages/variables.ts`.
- **Extraction** : `parseTemplateTokens` / `extractVariableNames`, syntaxe de repli `{{x|défaut}}`.
- **Validation statique à l'enregistrement** (`validateTemplateVariables(body, nature)`) : matrice signal/liste (`STANDARD_VARIABLES`), refus explicite d'une variable inconnue, d'une variable réservée à l'autre nature (« {{signal_date}} n'existe pas pour une campagne alimentée par une liste »), ou d'un repli sur `{{prenom}}`.
- **Rendu** (`renderTemplate(body, values)`) : substitution + valeurs de repli ; une variable vide sans repli est remontée dans `missing` (jamais un `{{champ}}` littéral ni un blanc envoyé).
- **Longueurs par canal** (`CHANNEL_WORD_LIMITS`, `exceedsWordLimit`) : 90 (email ouverture) / 70 (relance) / 45 (note LinkedIn) / 60 (message LinkedIn) / 120 (courrier).

**Application dans le séquenceur** (règle #2) : `composeTick` gère deux nouveaux blocages — `missing_variable` (variable non résolue) et `missing_locale` (variante de langue absente). Les deux **bloquent l'action mais N'ARRÊTENT PAS l'inscription** (statut `active`, `next_action_at` null) : c'est récupérable, l'opérateur complète le contact ou ajoute la variante, un re-tick réévalue. Le worker charge le corps **par la langue du contact** (`contacts.locale`), assemble les valeurs (contact/compte/persona/signal/liste), rend, et trace la version exacte (`actions.template_id`). Les champs manquants sont nommés dans `actions.payload.missingVariables` (pour le regroupement UI).

**Décisions / périmètre** :
- **Rendu local réservé aux canaux dont Jay Reach possède le corps** (message LinkedIn, courrier). L'email est rendu par Smartlead (variables = champs du lead) ; son blocage variable relève de T20/Smartlead, pas d'ici.
- Sans `contacts.locale` connue, on prend la dernière version (repli, pas de `missing_locale`) plutôt que de bloquer.
- **Non fait dans cette partie** (partie « éditeur » à suivre) : l'écran d'édition versionné avec onglets fr/en/nl et indicateur de manque, le panneau d'historique de versions + taux de réponse, la traduction assistée relue, le retour arrière de version (nécessite une colonne `is_active`/`status` — absente, non ajoutée ici), et l'UI de regroupement des actions bloquées par champ manquant. Le `guards.ts` porte encore une logique `unresolvedVariables` parallèle (non branchée) ; à unifier avec `composeTick` lors de cette partie.

**Vérifié** : `bash test/pg-verify/sequence-tick.sh` étape 8 (base locale, zéro envoi réel) → fr + prénom présent = corps substitué dispatché (« Bonjour Marie chez … ») + `template_id` tracé ; fr + prénom manquant = **bloqué `missing_variable`**, champ `prenom` nommé, inscription non arrêtée ; langue `nl` sans variante = **bloqué `missing_locale`**. + 21 tests unitaires (extraction, validation par nature, rendu/repli, longueurs, `composeTick`).

## Résolu — Enfilage email depuis le tick vers Smartlead (T20) [2026-08-25]

Le tick du séquenceur émettait bien l'action email mais **n'enfilait pas de job Smartlead** (le `dispatch → Smartlead` existait, mais rien ne l'alimentait pour l'email). Comblé.

- **Mapping PAR PERSONA [révisé 2026-08-25 après review #20]** : première version = `campaigns.smartlead_campaign_id` (une campagne Smartlead par campagne Jay Reach). Review JB : mauvaise granularité. Le socle v1 mappe **par persona** (`smartlead_campaigns (workspace, persona) → campagne`, avec `enabled`) — on n'écrit pas la même chose à un Directeur de site et à un Responsable RH, donc pas la même séquence Smartlead ; et un même couple ne peut pas exprimer deux personas vers une même campagne ni le toggle d'activation. Migration `20260825130000_smartlead_campaigns.sql` : table `smartlead_campaigns (organization_id, persona_id, campaign_id, campaign_name, enabled)`, unicité `(org, persona)`, RLS (lecture viewer+, écriture admin+). La colonne `campaigns.smartlead_campaign_id` est retirée (drop if exists). Plusieurs personas peuvent partager une campagne ; `enabled=false` suspend l'envoi **sans perdre l'identifiant**.
- **Tick** (`tickDueEnrollments`) : la requête résout la campagne Smartlead via **la persona du contact** (`left join smartlead_campaigns sc on sc.persona_id = c.persona_id and sc.enabled`), + les champs du lead (contact + compte). Quand un envoi email est autorisé, un job `actions.dispatch` (channel `email`, `campaignId` = id Smartlead de la persona, `leads` = [contact assemblé : email, prénom, nom, entreprise, site, LinkedIn]) est produit. **Sans mapping activé pour la persona** : action planifiée mais **non dispatchée** (log), jamais d'envoi vers une campagne inconnue.
- **Dédup** : correction de `runTick` — la réf de dédup de `actions.dispatch` retombait sur `'x'` pour l'email (tous les emails auraient partagé un id) ; elle utilise désormais l'adresse.

**Vérifié hermétiquement** (`bash test/pg-verify/sequence-tick.sh`, étape 7) : persona → campagne `SL-EMAIL-77` **activée** → 1 job email + lead assemblé (société depuis le compte) ; mapping **désactivé** (`enabled=false`) → 0 job dispatché mais identifiant conservé.

**Reste (raffinements)** : régler ces mappings **dans l'app** = onglet Campagnes (**T24**, relie chaque persona active à sa campagne Smartlead avec le toggle) ; pour l'instant via SQL.

## Résolu — Garde d'authentification (middleware) [retour PR de JB, 2026-08-24]

**Constat de JB.** Le `middleware.ts` était un no-op (`matcher: ['/__middleware_disabled__']`, neutralisé après une `EvalError` du runtime edge au démarrage à vide). Résultat : aucun des écrans applicatifs n'avait de garde d'authentification (les server actions, elles, restent protégées par `requireUser`/`requireRole`). Risque faible tant que les écrans affichent des données de démo, sérieux dès qu'ils sont branchés sur de vraies données.

**Décision prise (2026-08-24).** Middleware rebranché avec une garde conditionnée à la présence de Supabase :
- **Supabase non configuré (mode démo)** : aucune donnée réelle, on ne verrouille pas (sinon `/login` serait inaccessible).
- **Supabase configuré (données réelles — exactement le scénario que JB pointe)** : toute route applicative non publique exige une session, sinon redirection vers `/login?next=…`.
- **Chemins publics** : `/login`, `/api/extension/*` (auth par token, pas par session), `/api/health`, `/extension/auth`.
- La `EvalError` d'origine venait du chargement du SDK Supabase au démarrage à vide ; `updateSession` ne l'importe que si l'URL + la clé anon sont présentes, ce qui évite le problème.
- **Test de non-régression** demandé par JB : `apps/web/lib/auth-guard.ts` isole la politique en fonction pure `decideAccess`, testée par `apps/web/lib/auth-guard.test.ts` (les 15 routes applicatives redirigent sans session quand Supabase est configuré). Le test échoue si une route applicative devient accessible sans session.

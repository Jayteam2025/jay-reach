# Changelog

Toutes les modifications notables de ce projet.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnement sémantique.

## [Non publié]

### Ajouté
- Spécification initiale du projet et maquettes des écrans principaux.
- **Branchement du moteur sur le worker (début)** — le code moteur repris est rendu importable (`@jay-reach/providers/signals`, `/enrichment`) ; la file `sources.discover` du worker est câblée sur les vrais connecteurs de signaux (Adzuna, France Travail). Le worker construit démarre contre un vrai Postgres avec le moteur branché (vérifié).
- **Reprise du code legacy (décision de l'éditeur : réutiliser ce qui fonctionne)** — portage de tout le moteur réel depuis les Edge Functions Deno vers `@jay-reach/providers`, plutôt que réécriture :
  - **Signaux** : Adzuna, France Travail, Apify, honeypot, scoring
  - **Résolution** : INSEE/SIRENE, référentiel + logique NAF, validateur de noms
  - **Enrichissement** : **FullEnrich** (client complet + résolution d'entreprise + dédup pattern + cascade géo)
  - **Envoi** : client Smartlead
  - **Vérification email** : Bouncer, Reoon, email-gate, email-pattern
  - **Sécurité** : chiffrement AES-256-GCM des credentials
  - Utilitaires : reconstruction de nom, validation d'URL, contrats de providers
  - Adapté au monorepo (imports ESM, `Deno.env`→`process.env`, `npm:`/esm.sh → paquets, globals Node) **sans changer la logique**. Compile / lint / build / tests verts. *(Le câblage au nouveau schéma — rate-limiter FullEnrich, dédup — se fait à l'étape « brancher sur le worker ».)*
- **T1** — Squelette du monorepo pnpm : `apps/{web,worker}`, `packages/{core,db,i18n,providers,ui}`, ESLint + Prettier + Vitest, CI GitHub Actions, `docker-compose.yml` (Postgres), `.env.example`. Vérifié : install + typecheck + build + test + lint verts, app web qui répond (`/api/health`).
- **T2** — Schéma de base et RLS : 28 tables du modèle de données (`docs/02-data-model.md`), enums, contrainte d'inscription unique par contact, fonction pivot RLS `app.user_orgs(role)`, policies lecture/écriture sur toutes les tables, `audit_events` append-only, bootstrap `app.create_organization`, seed d'une organisation de démo (fictive). Vérifié sur Postgres 16 : migrations appliquées + test d'isolation inter-organisations vert.
- **T3** — Authentification, organisations, rôles : les 4 rôles + hiérarchie et `requireRole()` dans `@jay-reach/core` (6 tests), auth Supabase SSR côté web (client serveur/navigateur, middleware de session, page de connexion), actions serveur (création d'org, invitations), table `invitations` + RLS + RPC `accept_invitation` (correspondance d'email), wrappers publics des RPC. Vérifié : tests rôles verts + test du flux d'invitation sur Postgres 16 (acceptation valide, rejet mauvais email).
- **T4** — Internationalisation FR/EN/NL : next-intl (config de requête par cookie, provider), messages dans `@jay-reach/i18n`, sélecteur de langue, `<html lang>` dynamique. Règle ESLint `i18next/no-literal-string` (aucune chaîne d'interface en dur, vérifiée). Vérifié au runtime : la home s'affiche en FR (défaut) et bascule en EN via cookie.
- **T5** — Coffre à credentials : secrets chiffrés via pgcrypto (`pgp_sym_encrypt`), clé hors base ; RPC `set_credential`/`get_credential` (service/worker uniquement), vue `credentials_public` sans secret + RLS admin-only sur la table. Catalogue de providers (manifests) dans `@jay-reach/providers`, écran de configuration **généré depuis les manifests**, actions serveur (enregistrement chiffré, test de connexion). Vérifié sur Postgres 16 : chiffré au repos, bonne clé déchiffre, mauvaise rejetée, un viewer ne voit jamais le secret.
- **T6** — Contrats et registre de providers : les 7 interfaces (`@jay-reach/core`), schéma de manifest validé par Zod, `ProviderRegistry` (chargement, validation, résolution par id/catégorie, rejet des doublons/manifests invalides), et le générateur `pnpm reach:scaffold <catégorie> <id>`. Vérifié : 4 tests de registre, scaffold testé (génération + garde-fous).
- **T7** — Runtime pg-boss : les 12 files (`@jay-reach/core`) créées avec reprise et **backoff exponentiel**, handlers branchés, arrêt propre. Écran d'admin des jobs (`/settings/jobs`) listant les files et leur politique. Worker bundlé via esbuild. Vérifié sur Postgres 16 : idempotence (deux insertions même id → un job) et traitement effectif d'un job.
- **T8** — Résolution d'entreprise : pipeline **4 passes** (domaine → annuaire légal+CP → trigram → arbitrage) pur et testable (`@jay-reach/core`), `accounts.resolution_status`, RPC trigram `search_accounts_trgm`, et le **filtre non désactivable d'opposition au démarchage** (trigger : suppression `account`/`sirene_opposition` créée automatiquement). Vérifié : 8 tests (accents, sigles, filiales, homonymes, passes) + trigram et opposition prouvés sur Postgres 16.
- **T9** — Moteur d'import de fichiers (`@jay-reach/core`, pur et testable) : parsing CSV avec détection de séparateur et guillemets, **mapping automatique multilingue** (FR/EN/NL, colonne inconnue ignorée), validation (ligne sans nom ni email rejetée), **déduplication en cascade** (email → LinkedIn → nom+entreprise) avec fusion qui complète sans écraser, et compte rendu avant validation. `context_note` déjà obligatoire au schéma. Vérifié : 6 tests couvrant tout le pipeline.
- **T9b** — Import des clients actuels : table `customer_list_entries`, correspondance **au niveau du compte** (SIREN → domaine → nom normalisé), trigger d'exclusion (suppression `account`/`customer_import`, motif en clair), et retrait d'une liste qui **ne touche pas aux désinscriptions réelles** (par `origin`). Vérifié sur Postgres 16 : match par SIREN, exclusion auto, retrait sélectif.
- **T10** — Connecteur `jobboard` : normalisation France Travail + Adzuna vers un signal `job_posting`, **exclusion des cabinets de recrutement** (codes NAF 78.10Z/78.20Z/78.30Z + blacklist de noms + regex), **déduplication multi-agrégateurs** par empreinte (entreprise + intitulé + code postal). Manifests providers (France Travail, Adzuna). Vérifié : 6 tests avec fixtures synthétiques (normalisation, exclusion NAF/nom, dédup).
- **T11** — Personas : correspondance persona ↔ intitulé **multilingue** (FR/EN/NL) avec exclusions et **détection d'ambiguïté** (arbitrage) dans `@jay-reach/core`, écran de définition (`/settings/personas`, liste + création) et action serveur. Vérifié : 5 tests (FR/EN/NL, exclusions, ambiguïté, aucun match).
- **T12** — Scoring : règles avant modèle (fraîcheur + exclusion cabinets → coût nul), **sortie validée par Zod**, parsing tolérant (fences, préambule, clamp du score), constructeur de message et **estimation de coût par appel** (`@jay-reach/core`). Prompt stocké hors code (éditable/versionné) et tracé via `audit_events`. Vérifié : 7 tests.
- **T13** — Écran Signaux + **design system complet** (docs/08) : identité « chronométrage sportif » — lime sur encre, polices Archivo / Geist Sans / Geist Mono via next/font (self-hébergées), aucune ombre, mono pour toutes les données. Flux avec filtres (à traiter / validés / écartés / à arbitrer), détail, motif d'écartement en clair, état vide en invitation. Validation visuelle (capture d'écran).
- **T14** — Orchestration d'enrichissement : providers **chaînés** dans un ordre configurable, arrêt au premier résultat au-dessus du **seuil de confiance**, **cache** (ne jamais payer deux fois), **budget** par organisation (arrêt avant dépassement) et **coût estimé avant exécution** (`@jay-reach/core`). Manifests FullEnrich + Dropcontact (annuaire légal built-in). Vérifié : 5 tests.
- **T15** — Identification des contacts : rattachement personne → persona par intitulé (multilingue, réutilise T11) et **calcul de la langue du contact** — dont le **cas belge** (Flandre → nl, Wallonie/Bruxelles → fr) — dans `@jay-reach/core`. Sépare identifiés / ambigus / non rattachés. Vérifié : 6 tests.
- **T17** — ⭐ Cœur du séquenceur (`@jay-reach/core/sequencer`, pur, sans aucun provider branché) : **machine à états** des inscriptions (états terminaux définitifs), **ordonnancement** (fenêtre horaire, lead time, jitter déterministe), **quotas** (report sans perte), **attribution des expéditeurs** (lien à vie, pause si sender inactif), **idempotence** du tick, décalage `callback`. **14 tests** couvrant la liste des « tests obligatoires » de `docs/04-sequenceur.md`. *(À relire attentivement — ticket le plus sensible du projet.)*
- **T18** — Les 9 garde-fous (`@jay-reach/core/sequencer/guards`) : suppression (dont client & opposition légale), un contact par compte et par jour, variables résolues, adresse postale vérifiée (courrier), quotas, fenêtre horaire, plafond de dépense, arrêt global. Chaque décision est **explicite** (`allow` / `defer` avec date / `block` avec motif), jamais un booléen. Une étape `call` ignore les gardes d'envoi. **11 tests**.
- **T16** — Écrans Prospects & Campagnes : **fiche entreprise** (SIREN/NAF/effectif en mono), contacts (avatars à initiales, lien LinkedIn, repli « pas de profil »), signaux liés, et le **tableau de séquence** signature (temps intermédiaires, étape courante en lime, canaux en codes mono). **Cartes de campagne à quatre chiffres** (vivier / contactés / réponses / positives) + barre de progression du vivier. Barre de navigation partagée. Revue visuelle (captures).

<!--
À chaque ticket terminé, ajouter une ligne sous la section appropriée :
### Ajouté / Modifié / Corrigé / Supprimé / Sécurité
-->

### Ajouté (spécification)
- Canal téléphone : étape sans envoi, tâche datée poussée vers le CRM.
- Notifications par email et notification bureau via Web Push.
- Import des clients actuels, avec exclusion au niveau du compte.
- Filtre non désactivable sur l'opposition légale au démarchage.
- Tickets pour le site vitrine et les pages légales.

### Modifié
- Domaine unifié sur `jay-reach.fr`.
- Périmètre v1 restreint au self-hosted ; l'offre hébergée devient le jalon 6.
- Règles de travail en dépôt existant : rien n'est supprimé sans audit préalable.

# Jay Reach — Moteur de Prospection Self-Hosted

**Jay Reach** est un moteur de prospection open-source (self-hosted) conçu pour les opérateurs commerciaux et les équipes RH. Il combine le scraping d'annonces d'emploi, la notation des signaux commerciaux, l'enrichissement de profils LinkedIn, la vérification de délivrabilité d'emails et la campagne d'outreach multi-canal.

> **Status :** Dépôt public. Licence **FSL-1.1-MIT** (source-available, conversion automatique en MIT après 2 ans). [Prêt à contribuer ?](CONTRIBUTING.md)

---

## Quickstart — Lancer une instance en 10 minutes

### Prérequis

- **Node.js** ≥ 22.12
- **pnpm** ≥ 10.0.0
- **Supabase CLI** (pour la gestion locale / déploiement)
- Un compte **Supabase** (gratuit ou payant)

### 1. Cloner et installer

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
pnpm install
```

### 2. Configuration Supabase

Créez un projet Supabase (ou utilisez un existant) et récupérez :
- **URL** : Settings → API → Project URL
- **Anon Key** : Settings → API → Anon key
- **Project Ref** : l'ID dans l'URL (ex. `VOTRE-REF-PROJET`)
- **Access Token** : Account Settings → Tokens

Créez un fichier `.env` à la racine :

```bash
cp .env.example .env
# Puis remplissez :
VITE_SUPABASE_URL=https://VOTRE-REF-PROJET.supabase.co
VITE_SUPABASE_ANON_KEY=VOTRE_CLE_ANON_PUBLIQUE
SUPABASE_ACCESS_TOKEN=VOTRE_TOKEN_CLI
SUPABASE_PROJECT_REF=VOTRE-REF-PROJET
SUPABASE_DB_PASSWORD=VOTRE_MOT_DE_PASSE_DB
```

### 3. Vérification de santé

```bash
pnpm doctor
```

Cela vérifie : Node.js, pnpm, Supabase CLI, accès DB, variables d'environnement.

### 4. Setup initial (migrations + edge functions)

```bash
pnpm setup
```

Cela :
- Applique les migrations SQL (socle, tables de prospection, RLS)
- Génère la clé de chiffrement (TOKEN_ENCRYPTION_KEY)
- Déploie les 38 edge functions
- Crée le workspace initial et l'user admin

### 5. Lancer l'app

```bash
pnpm dev
```

Ouvrez [http://localhost:8080](http://localhost:8080).

### 6. Configuration des fournisseurs

Une fois inscrit, accédez à l'onglet **Config** pour brancher les providers :
- **LLM** : Anthropic Claude (Haiku/Sonnet) — clé [ici](https://console.anthropic.com)
- **Enrichissement** : FullEnrich — clé [ici](https://app.fullenrich.com)
- **Vérif email** : Bouncer ou Reoon — clé [ici](https://usebouncer.com) ou [ici](https://reoon.com)
- **Outreach** : Smartlead — clé [ici](https://smartlead.ai)
- **Sourcing** : Adzuna, France Travail (gratuit)

Les clés sont **chiffrées en base de données** — jamais en `.env` ou logs.

### 7. Première campagne

1. Créez un **Trigger** (détecteur de signaux : annonces d'emploi RH, directeurs commerciaux, etc.)
2. Créez une **Persona** (critères de ciblage : secteur, géographie, taille d'entreprise)
3. Lancez le **Sourcing** pour scraper les candidatures
4. Passez à la **Notation** et **Enrichissement**
5. Validez via **Audit Emails** et poussez vers **Smartlead**

---

## Architecture

Jay Reach suit un pipeline multi-étapes :

```
Sourcing (Adzuna, France Travail)
         ↓
Scoring (LLM + signaux commerciaux)
         ↓
Archivage (prospects low-score vs top-15)
         ↓
Enrichissement (FullEnrich, LinkedIn)
         ↓
Audit Patterns (déduction emails)
         ↓
Vérif Délivrabilité (Bouncer, Reoon)
         ↓
Gate de Délivrabilité (règles go/no-go)
         ↓
Push Smartlead (campagne cold email)
```

Voir **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** pour un détail complet : schéma des données, table des edge functions, flux événements.

---

## Dossier `docs/`

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Pipeline, modèle des données, edge functions
- **[data-model.md](docs/data-model.md)** — Tables Supabase, RLS, chiffrement des secrets
- **[providers.md](docs/providers.md)** — Brancher des fournisseurs (LLM, enrichissement, email)
- **[self-host.md](docs/self-host.md)** — Guide détaillé pour deployer en production
- **[adr/](docs/adr/)** — Architecture Decision Records

---

## Développement

### Checks avant un commit

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript strict
pnpm build         # Vite build
pnpm test:run      # Vitest
pnpm check:hardcodes  # Pas de clés hardcodées
```

### Tests

**Front** : Vitest + Testing Library

```bash
pnpm test:run
```

**Back** : Deno test (edge functions)

```bash
cd supabase/functions/_shared
deno test
```

### Branches

- **`main`** : branche protégée, push interdit, PR + review requis
- **`feat/*` / `fix/*`** : vos branches de travail
- Voir [branch-protection.md](docs/branch-protection.md) pour les règles

---

## Contribution

1. **Lisez [CONTRIBUTING.md](CONTRIBUTING.md)** — processus et conventions
2. **Signez le CLA** (une fois pour votre première PR)
3. **Ouvrez une PR** pour review
4. **Un admin reviendra** votre code et mergera

Merci de votre intérêt !

---

## Licence

Jay Reach est sous **Functional Source License (FSL-1.1-MIT)**, avec conversion automatique en MIT 2 ans après la première version publique. Voir [LICENSE](LICENSE) pour les détails et la définition de "Competing Use".

---

## Sécurité

Signalez les vulnérabilités en privé : [SECURITY.md](SECURITY.md).

---

## Contact

- **Mainteneur principal** : @Jeeiib
- **Formulaire de contribution** : [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSdkcrqy0ARxDwF9_bPQndiV1UkiK4fWwqlVcURV4vkQpz40kw/viewform)
- **Code of Conduct** : [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

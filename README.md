> **Français** | [English](README.en.md)

# Jay Reach — Moteur de Prospection B2B Self-Hosted

**Jay Reach** est un moteur de prospection open-source (self-hosted) configurable par workspace. Chaque opérateur définit ses déclencheurs de signaux, personas, templates et pousse ses campagnes via email. Pipeline complet : scraping d'annonces → scoring IA → enrichissement de profils → audit de délivrabilité → outreach Smartlead.

[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue.svg)](LICENSE) [![CI](https://github.com/Jayteam2025/jay-reach/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayteam2025/jay-reach/actions)

---

## Quickstart — 6 étapes, 10 minutes

### Prérequis

- **Node.js** ≥ 22.12, **pnpm** ≥ 10.0.0
- **Supabase CLI** (local + déploiement)
- Un compte **Supabase** (gratuit)

### 1. Cloner et installer

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
pnpm install
```

### 2. Configuration Supabase

Créez un projet Supabase et récupérez (Settings → API) :
- **URL** : `https://VOTRE-REF.supabase.co`
- **Anon Key** : clé publique  
- **Project Ref** : ID du projet
- **Access Token** : depuis Account Settings → Tokens

Créez `.env` :

```bash
cp .env.example .env
```

Remplissez les variables :

```env
VITE_SUPABASE_URL=https://VOTRE-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_ACCESS_TOKEN=your_token
SUPABASE_PROJECT_REF=your-ref
SUPABASE_DB_PASSWORD=your_password
```

### 3. Vérification santé

```bash
pnpm run doctor
```

Vérifie Node.js, pnpm, Supabase CLI, accès DB, variables d'environnement.

### 4. Setup initial

```bash
pnpm run setup
```

Applique migrations SQL, déploie 30 edge functions, crée workspace + user admin.

### 5. Lancer l'app

```bash
pnpm dev
```

Ouvrez [http://localhost:8080](http://localhost:8080) → inscrivez-vous (1er user = admin).

### 6. Configurer les providers

Allez à l'onglet **Providers** et branchez vos clés API (chiffrées en DB) :
- **LLM** : Anthropic Claude (Haiku/Sonnet pour la notation)
- **Enrichissement** : FullEnrich (données B2B)
- **Vérif email** : Bouncer ou Reoon
- **Outreach** : Smartlead (cold email)
- **Sourcing** : Adzuna + France Travail (gratuit)

📖 **[Guide complet](docs/self-host.md)** pour la mise en prod.

---

## 7 Onglets Principaux

| Onglet | Rôle |
|--------|------|
| **Entreprises** | Prospect list, scoring, enrichissement |
| **Déclencheurs** | Définir les signaux à scraper (annonces RH, taille, etc.) |
| **Personas** | Créer des profils cibles (secteur, géographie) |
| **Templates** | Rédiger les messages email campagnes |
| **Branding** | Signature, domaine, sender |
| **Providers** | Connecter les API externes |
| **Campagnes** | Mapper personas → campagnes Smartlead |

---

## Pipeline Funnel

```
Sourcing     (Adzuna + France Travail)
    ↓
Scoring      (LLM : déclencheurs activés ?)
    ↓
Enrichissement (FullEnrich : données B2B)
    ↓
Gate Email   (Bouncer/Reoon : délivrable ?)
    ↓
Push Smartlead (campagne cold email)
```

Détail complet : **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** (tables, RPC, 30 edge functions).

---

## Stack Technique

- **Frontend** : React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + TanStack Query
- **Backend** : Supabase (PostgreSQL 17) + Auth native + Edge Functions (Deno)
- **Tests** : Vitest (front) + Deno test (back)
- **Déploiement** : Supabase edge functions + RLS + chiffrement AES-GCM pour secrets

---

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Pipeline, schéma DB, 30 edge functions
- **[data-model.md](docs/data-model.md)** — Tables Supabase, RLS, token encryption
- **[providers.md](docs/providers.md)** — Intégrer des providers (LLM, enrichissement)
- **[self-host.md](docs/self-host.md)** — Déployer en production (étapes détaillées)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Contribuer au projet
- **[SECURITY.md](SECURITY.md)** — Signaler les vulnérabilités en privé
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — Code de conduite
- **[LICENSE](LICENSE)** — Licence FSL-1.1-MIT
- **[adr/](docs/adr/)** — Architecture Decision Records

---

## Développement Local

### Checks obligatoires avant commit

```bash
pnpm lint                # ESLint
pnpm typecheck          # TypeScript strict
pnpm build              # Build prod
pnpm test:run           # Tests Vitest
node scripts/check-no-jay-hardcodes.mjs --strict  # 0 hardcodes
```

### Tests

```bash
# Frontend
pnpm test:run

# Backend (Edge Functions)
cd supabase/functions/_shared && deno test
```

### Branches et PR

- **`main`** : protégée, PR + review requis
- **`feat/*` / `fix/*`** : vos branches de travail

Voir **[branch-protection.md](docs/branch-protection.md)** pour les règles détaillées.

---

## Signaler un bug ou idée

- **Bug** : [Ouvrir une Issue GitHub](https://github.com/Jayteam2025/jay-reach/issues/new?template=bug_report.md)
- **Feature** : [Ouvrir une Issue GitHub](https://github.com/Jayteam2025/jay-reach/issues/new?template=feature_request.md)
- **Sécurité** : **Jamais d'issue publique.** Voir **[SECURITY.md](SECURITY.md)** pour signaler en privé.

---

## Licence

Jay Reach est sous **Functional Source License (FSL-1.1-MIT)** avec conversion automatique en MIT 2 ans après la version publique initiale. Voir **[LICENSE](LICENSE)** pour les détails complets et la définition de « Competing Use ».

---

## Contribution

1. **Lire [CONTRIBUTING.md](CONTRIBUTING.md)** — processus de contribution
2. **Signer le CLA** via case à cocher en PR (aucun document séparé)
3. **Pousser une PR** avec description claire
4. **Review + merge** par un mainteneur

Merci de votre intérêt ! 🙌

---

**Mainteneur principal** : [@Jeeiib](https://github.com/Jeeiib)

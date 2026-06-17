> [Français](README.md) | **English**

# Jay Reach — Self-Hosted B2B Prospecting Engine

**Jay Reach** is an open-source prospecting engine (self-hosted) configurable per workspace. Each operator defines their signal triggers, personas, templates, and pushes campaigns via email. Complete pipeline: job posting scraping → AI scoring → profile enrichment → deliverability audit → Smartlead outreach.

[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue.svg)](LICENSE) [![CI](https://github.com/Jayteam2025/jay-reach/actions/workflows/ci.yml/badge.svg)](https://github.com/Jayteam2025/jay-reach/actions)

---

## Quickstart — 6 steps, 10 minutes

### Prerequisites

- **Node.js** ≥ 22.12, **pnpm** ≥ 10.0.0
- **Supabase CLI** (local + deployment)
- A **Supabase** account (free)

### 1. Clone and install

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
pnpm install
```

### 2. Supabase Configuration

Create a Supabase project and retrieve (Settings → API):
- **URL**: `https://YOUR-REF.supabase.co`
- **Anon Key**: public key
- **Project Ref**: project ID
- **Access Token**: from Account Settings → Tokens

Create `.env`:

```bash
cp .env.example .env
```

Fill in the variables:

```env
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_ACCESS_TOKEN=your_token
SUPABASE_PROJECT_REF=your-ref
SUPABASE_DB_PASSWORD=your_password
```

### 3. Health check

```bash
pnpm run doctor
```

Verifies Node.js, pnpm, Supabase CLI, DB access, environment variables.

### 4. Initial setup

```bash
pnpm run setup
```

Applies SQL migrations, deploys 30 edge functions, creates workspace + admin user.

### 5. Launch the app

```bash
pnpm dev
```

Open [http://localhost:8080](http://localhost:8080) → sign up (first user = admin).

### 6. Configure providers

Go to the **Providers** tab and connect your API keys (encrypted in DB):
- **LLM**: Anthropic Claude (Haiku/Sonnet for scoring)
- **Enrichment**: FullEnrich (B2B data)
- **Email verification**: Bouncer or Reoon
- **Outreach**: Smartlead (cold email)
- **Sourcing**: Adzuna + France Travail (free)

**[Full guide](docs/self-host.en.md)** for production deployment.

---

## 7 Main Tabs

| Tab | Role |
|-----|------|
| **Companies** | Prospect list, scoring, enrichment |
| **Triggers** | Define signals to scrape (job postings, size, etc.) |
| **Personas** | Create target profiles (industry, geography) |
| **Templates** | Write campaign email messages |
| **Branding** | Signature, domain, sender |
| **Providers** | Connect external APIs |
| **Campaigns** | Map personas → Smartlead campaigns |

---

## Pipeline Funnel

```
Sourcing     (Adzuna + France Travail)
    ↓
Scoring      (LLM: triggers activated ?)
    ↓
Enrichment   (FullEnrich: B2B data)
    ↓
Email Gate   (Bouncer/Reoon: deliverable ?)
    ↓
Push Smartlead (cold email campaign)
```

Full details: **[ARCHITECTURE.md](docs/ARCHITECTURE.en.md)** (tables, RPC, 30 edge functions).

---

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + TanStack Query
- **Backend**: Supabase (PostgreSQL 17) + native Auth + Edge Functions (Deno)
- **Tests**: Vitest (front) + Deno test (back)
- **Deployment**: Supabase edge functions + RLS + AES-GCM encryption for secrets

---

## Documentation

- **[ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md)** — Pipeline, DB schema, 30 edge functions
- **[data-model.en.md](docs/data-model.en.md)** — Supabase tables, RLS, token encryption
- **[providers.en.md](docs/providers.en.md)** — Integrating providers (LLM, enrichment)
- **[self-host.en.md](docs/self-host.en.md)** — Production deployment (detailed steps)
- **[CONTRIBUTING.en.md](CONTRIBUTING.en.md)** — Contributing to the project
- **[SECURITY.en.md](SECURITY.en.md)** — Report vulnerabilities privately
- **[CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md)** — Code of Conduct
- **[LICENSE](LICENSE)** — FSL-1.1-MIT License
- **[adr/](docs/adr/)** — Architecture Decision Records

---

## Local Development

### Required checks before commit

```bash
pnpm lint                # ESLint
pnpm typecheck          # TypeScript strict
pnpm build              # Build prod
pnpm test:run           # Vitest tests
node scripts/check-no-jay-hardcodes.mjs --strict  # 0 hardcodes
```

### Tests

```bash
# Frontend
pnpm test:run

# Backend (Edge Functions)
cd supabase/functions/_shared && deno test
```

### Branches and PR

- **`main`**: protected, PR + review required
- **`feat/*` / `fix/*`**: your working branches

See **[branch-protection.en.md](docs/branch-protection.en.md)** for detailed rules.

---

## Report a bug or feature idea

- **Bug**: [Open a GitHub Issue](https://github.com/Jayteam2025/jay-reach/issues/new?template=bug_report.md)
- **Feature**: [Open a GitHub Issue](https://github.com/Jayteam2025/jay-reach/issues/new?template=feature_request.md)
- **Security**: **Never open a public issue.** See **[SECURITY.en.md](SECURITY.en.md)** to report privately.

---

## License

Jay Reach is under **Functional Source License (FSL-1.1-MIT)** with automatic conversion to MIT 2 years after initial public release. See **[LICENSE](LICENSE)** for full details and definition of « Competing Use ».

---

## Contributing

1. **Read [CONTRIBUTING.en.md](CONTRIBUTING.en.md)** — contribution process
2. **Sign the CLA** via checkbox in PR (no separate document)
3. **Push a PR** with clear description
4. **Review + merge** by a maintainer

Thank you for your interest!

---

**Main maintainer**: [@Jeeiib](https://github.com/Jeeiib)

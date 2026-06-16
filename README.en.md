> [Français](README.md) | **English**

# Jay Reach — Self-Hosted Prospecting Engine

**Jay Reach** is an open-source prospecting engine (self-hosted) designed for commercial operators and HR teams. It combines job posting scraping, commercial signal scoring, LinkedIn profile enrichment, email deliverability verification, and multi-channel outreach campaigns.

> **Status:** Public repository. License **FSL-1.1-MIT** (source-available, automatic conversion to MIT after 2 years). [Ready to contribute?](CONTRIBUTING.en.md)

---

## Quickstart — Launch an instance in 10 minutes

### Prerequisites

- **Node.js** ≥ 22.12
- **pnpm** ≥ 10.0.0
- **Supabase CLI** (for local management / deployment)
- A **Supabase** account (free or paid)

### 1. Clone and install

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
pnpm install
```

### 2. Supabase Configuration

Create a Supabase project (or use an existing one) and retrieve:
- **URL**: Settings → API → Project URL
- **Anon Key**: Settings → API → Anon key
- **Project Ref**: the ID in the URL (e.g., `YOUR-PROJECT-REF`)
- **Access Token**: Account Settings → Tokens

Create a `.env` file in the root:

```bash
cp .env.example .env
# Then fill in:
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_ACCESS_TOKEN=YOUR_CLI_TOKEN
SUPABASE_PROJECT_REF=YOUR-PROJECT-REF
SUPABASE_DB_PASSWORD=YOUR_DB_PASSWORD
```

### 3. Health check

```bash
pnpm run doctor
```

This verifies: Node.js, pnpm, Supabase CLI, DB access, environment variables.

### 4. Initial setup (migrations + edge functions)

```bash
pnpm run setup
```

This:
- Applies SQL migrations (foundation, prospecting tables, RLS)
- Generates encryption key (TOKEN_ENCRYPTION_KEY)
- Deploys 38 edge functions
- Creates initial workspace and admin user

### 5. Launch the app

```bash
pnpm dev
```

Open [http://localhost:8080](http://localhost:8080).

### 6. Configure providers

Once logged in, go to the **Config** tab to connect providers:
- **LLM**: Anthropic Claude (Haiku/Sonnet) — key [here](https://console.anthropic.com)
- **Enrichment**: FullEnrich — key [here](https://app.fullenrich.com)
- **Email verification**: Bouncer or Reoon — key [here](https://usebouncer.com) or [here](https://reoon.com)
- **Outreach**: Smartlead — key [here](https://smartlead.ai)
- **Sourcing**: Adzuna, France Travail (free)

Keys are **encrypted in the database** — never in `.env` or logs.

### 7. First campaign

1. Create a **Trigger** (signal detector: job postings for HR, sales directors, etc.)
2. Create a **Persona** (targeting criteria: industry, geography, company size)
3. Launch **Sourcing** to scrape applications
4. Move to **Scoring** and **Enrichment**
5. Validate via **Email Audit** and push to **Smartlead**

---

## Architecture

Jay Reach follows a multi-stage pipeline:

```
Sourcing (Adzuna, France Travail)
         ↓
Scoring (LLM + commercial signals)
         ↓
Archiving (low-score prospects vs top-15)
         ↓
Enrichment (FullEnrich, LinkedIn)
         ↓
Pattern Audit (email deduction)
         ↓
Deliverability Check (Bouncer, Reoon)
         ↓
Deliverability Gate (go/no-go rules)
         ↓
Smartlead Push (cold email campaign)
```

See **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** for full details: data schema, edge function table, event flow.

---

## `docs/` folder

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Pipeline, data model, edge functions
- **[data-model.md](docs/data-model.md)** — Supabase tables, RLS, secret encryption
- **[providers.md](docs/providers.md)** — Connecting providers (LLM, enrichment, email)
- **[self-host.md](docs/self-host.md)** — Detailed production deployment guide
- **[adr/](docs/adr/)** — Architecture Decision Records

---

## Development

### Checks before a commit

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript strict
pnpm build         # Vite build
pnpm test:run      # Vitest
pnpm check:hardcodes  # No hardcoded keys
```

### Tests

**Front**: Vitest + Testing Library

```bash
pnpm test:run
```

**Back**: Deno test (edge functions)

```bash
cd supabase/functions/_shared
deno test
```

### Branches

- **`main`**: protected branch, direct push forbidden, PR + review required
- **`feat/*` / `fix/*`**: your working branches
- See [branch-protection.md](docs/branch-protection.md) for rules

---

## Contributing

1. **Read [CONTRIBUTING.en.md](CONTRIBUTING.en.md)** — process and conventions
2. **Sign the CLA** (once for your first PR)
3. **Open a PR** for review
4. **An admin will review** your code and merge

Thank you for your interest!

---

## License

Jay Reach is under **Functional Source License (FSL-1.1-MIT)**, with automatic conversion to MIT 2 years after the first public version. See [LICENSE](LICENSE) for details and the definition of "Competing Use".

---

## Security

Report vulnerabilities privately: [SECURITY.en.md](SECURITY.en.md).

---

## Contact

- **Main maintainer**: @Jeeiib
- **Code of Conduct**: [CODE_OF_CONDUCT.en.md](CODE_OF_CONDUCT.en.md)

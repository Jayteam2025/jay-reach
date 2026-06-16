# ADR 0007 : Stack technique

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

Le stack actuel Jay est React 18 + Vite + TS + Tailwind + Supabase + Deno edge functions. On veut continuer sur cette base pour minimiser le risque, mais on doit ajouter ou expliciter quelques outils.

## Decision

### Frontend

| Couche | Choix | Pourquoi |
|---|---|---|
| Framework | **React 18** | Continuite Jay, ecosysteme mature, SSR pas necessaire (app interne) |
| Build | **Vite 7** | Continuite, fast HMR, build rapide |
| Style | **Tailwind 3** | Continuite |
| Composants | **shadcn/ui** (Radix) | Continuite, copy-paste components (proprietaire user) |
| Server state | **TanStack Query 5** | Continuite, dejà rodé |
| Client state | **Zustand** (NEW) | Plus simple que Redux, idiomatic, ~1kB. A introduire pour les state complexes (enrichment job, kanban, message generation) |
| Routing | **React Router 6** | Continuite |
| Forms | **React Hook Form + Zod** | Continuite |
| i18n | **i18next + react-i18next** | Continuite, ajouter namespaces dedies prospection |
| Icons | **Lucide React** | Continuite |
| Animations | **Framer Motion** | Continuite |
| Charts (futur) | **Recharts** ou **Tremor** | A trancher si besoin |
| Tables | **TanStack Table** (NEW) | Pour les vues lead/entreprises avec sort/filter |

### Backend

| Couche | Choix | Pourquoi |
|---|---|---|
| Database | **Supabase Postgres 17** | Continuite |
| Runtime serverless | **Deno Edge Functions** | Continuite, Web Standard APIs |
| Queue async | **pg_cron + pg_net** | Continuite, deja bien rodde |
| Storage | **Supabase Storage** | Continuite (CV PDF, attachments) |
| Auth | **Supabase Auth** | Continuite |
| Realtime | **Supabase Realtime** | Pour notifications UI live (enrichment progress, new signals) |

### Validation et typage

| Couche | Choix | Pourquoi |
|---|---|---|
| Schemas runtime | **Zod 3** | Continuite, standard de facto TS |
| Types DB | **supabase gen types** | Generation automatique depuis le schema |
| Frontieres HTTP | **Zod schemas obligatoires** (NEW enforcement) | Aux frontieres edge functions (request body) et frontend (responses) |
| JSONB columns | **Zod schemas par colonne JSONB** (NEW) | Aujourd'hui `: any`, demain typees strictes |

### Tests

| Type | Choix | Pourquoi |
|---|---|---|
| Unit | **Vitest** | Continuite, rapide, ESM-native |
| Component | **Testing Library** | Continuite |
| E2E | **Playwright** (NEW) | Standard OSS, on en aura besoin pour les flows critiques |
| DB | **pgTAP** (NEW) | Tests SQL pour RLS et fonctions PG |
| Provider integration | **Vitest avec env reel + skip si pas de cle** | Test vrai-API optionnel |

### Build et CI

| Outil | Choix | Pourquoi |
|---|---|---|
| Monorepo | **pnpm 9 + Turborepo 2** | Voir ADR 0002 |
| Bundler | **Vite (frontend) + Deno bundle (worker)** | Continuite |
| Linter | **ESLint 9 + typescript-eslint** | Continuite |
| Formatter | **Prettier** | Continuite |
| Pre-commit | **Husky + lint-staged** | Continuite |
| CI | **GitHub Actions** | Continuite |
| Type-check | **tsc --noEmit** sur chaque package | Standard |
| Pre-push | **build + test:run + lint** | Avec Husky |

### Observability

| Couche | Choix OSS | Choix Cloud Jay |
|---|---|---|
| Logs frontend | console structure | console + Sentry |
| Logs backend | Pino (NEW) | Pino + Axiom ou Sentry |
| Errors | `console.error` | Sentry |
| Metrics | (rien par defaut) | OpenTelemetry + Grafana |
| Tracing | (rien par defaut) | OpenTelemetry |
| Uptime | (rien par defaut) | UptimeRobot ou Better Stack |

Les observability tools sont **optionnels** en OSS (pour ne pas forcer un Sentry inscription). En Cloud, on les active.

### LLM

| Usage | Choix |
|---|---|
| Defaut | **Anthropic Claude Sonnet 4.6** (continuite) |
| Alternatif | **Mistral Large** (continuite) |
| Fallback futur | **OpenAI GPT-4o** (a ajouter via provider abstraction) |
| Local (futur) | **Ollama** (a ajouter via provider abstraction) |

Tous via l'interface `LLMProvider` (voir ADR 0005).

### Email infra

| Usage | Cloud Jay | OSS self-host |
|---|---|---|
| Transactionnel (signup, recap) | **Resend** | Resend, SendGrid, SMTP custom (configurable) |
| Outreach campagnes | **Smartlead** | Smartlead, Instantly, ou autre (via EmailSender interface) |
| Templates HTML | **React Email** (NEW) | React Email |

### Documentation

| Type | Choix |
|---|---|
| Docs developer | **Markdown dans `docs/`** |
| Docs API | **TypeDoc** generes a partir du code |
| Docs user | **Mintlify** ou **Docusaurus** (a trancher) |
| Tutoriels | Markdown + screenshots |

## Stack a NE PAS introduire

Pour eviter la sur-complexite, on **rejette** :

- **Next.js** : pas besoin de SSR pour un outil interne, Vite suffit
- **tRPC** : Supabase suffit (REST + Realtime), overkill
- **Prisma** : Supabase native client suffit
- **Redux** : Zustand + TanStack Query suffit
- **GraphQL** : pas de cas d'usage, complexite injustifiee
- **Microservices** : monolithe modulaire (monorepo) suffit
- **Nx** : Turborepo plus simple
- **Yarn** : pnpm plus moderne

## Versions cibles

A figer dans `package.json` racine :

```json
{
  "engines": {
    "node": ">=22.12",
    "pnpm": ">=9.0"
  },
  "packageManager": "pnpm@9.x.x"
}
```

Deno version : >= 1.46 (Supabase Edge Functions default).
PostgreSQL : 17 (Supabase actuel).

## Consequences

### Positives

- **Continuite** : la majorite du stack est deja en place dans Jay, transition douce
- **Standards modernes** : pnpm, Turborepo, Zod, Playwright, React Hook Form sont 2025+ standard
- **Pas de magie** : tous les outils sont mainstream et bien documentes
- **Onboarding rapide** pour les contributeurs (stack lisible)

### Negatives

- **Ajouts a apprendre** : Zustand, Playwright, pgTAP, React Email, Pino sont nouveaux pour l'equipe
- **Configurations multiples** : ESLint multi-package, TS multi-package, peut etre complexe au debut
- **Lock-in Supabase** : on est dependants de Supabase pour DB, auth, storage, realtime, edge functions. Si Supabase change ses policies, impact direct. Mitigation : Supabase est open-source self-hostable.

### Migration depuis Jay actuel

- React, Vite, Tailwind, shadcn, TanStack Query : aucun changement
- Supabase, Deno : aucun changement
- A ajouter : Zustand (state machine kanban + enrichment), Playwright (E2E), Pino (worker logs), Zod aux frontieres (renforcement)
- A retirer : eventuels remnants de Redux (s'il y en a), `console.log` ad-hoc en backend

## Alternatives considerees

### Alt 1 : Migration vers Next.js

Rejete. Overkill pour notre cas, app interne. Vite suffit et est plus simple.

### Alt 2 : Hono ou Elysia au lieu de Deno Edge Functions

Rejete. Supabase Edge Functions sont en Deno, on n'a pas a switcher. Hono pourrait s'integrer dedans si besoin (Hono runs in Deno).

### Alt 3 : Drizzle au lieu de Supabase client

Considere mais rejete pour V1. Le client Supabase suffit. Drizzle pourrait s'ajouter en V2 si on veut un ORM type-safe complet.

### Alt 4 : Server Components React (RSC)

Rejete. Vite ne supporte pas RSC en V1, c'est trop tot. On reste sur React classique avec TanStack Query.

# ADR 0009 : Standalone-first Phasing (Phase 1 flat, multi-tenant integration deferred)

**[FR]** Voir [0009-standalone-first-phasing.md](./0009-standalone-first-phasing.md)

- **Status** : Accepted (Source of Truth for phasing)
- **Date** : 2026-06-16
- **Last Updated** : 2026-06-16
- **Decision Makers** : Alexandre De Clercq, Jean-Baptiste Renart
- **Supersedes** : ADR 0001 and 0002 for Phase 1 (replaced by flat layout)

## Context

ADR 0001 and 0002 described an ambitious strategy :
- ADR 0001 : OSS + SaaS on same codebase (dual-distribution)
- ADR 0002 : Monorepo pnpm + Turborepo from the start

When planning Phase 1 (extracting Jay Reach from Jay monorepo), we realized that **immediately delivering a complex monorepo structure would slow down product arrival to the 13 initial users**. A **flat layout structure** enables faster Phase 1 delivery, with multi-tenant integration + monorepo deferred to Phase 2.

## Decision

For **Phase 1 (initial OSS delivery)**, Jay Reach repo starts in **flat layout structure** :

```
jay-reach/
├── src/
│   ├── components/          # React UI (shadcn-based)
│   ├── features/
│   │   ├── prospection/
│   │   ├── enrichment/
│   │   ├── messaging/
│   │   └── ...
│   ├── hooks/
│   ├── lib/
│   ├── pages/
│   ├── types/
│   ├── locales/
│   └── __tests__/
├── supabase/
│   ├── functions/           # Deno edge functions
│   │   ├── prospect-enricher/
│   │   ├── score-prospect-signals/
│   │   ├── send-via-smartlead/
│   │   ├── _shared/         # Shared Deno modules
│   │   └── ...
│   ├── migrations/          # SQL migrations
│   └── types.ts             # Generated Supabase types
├── scripts/
├── docs/
├── .github/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

**Phase 1 flat layout advantages** :
- Simple setup, 0 friction for clone/install
- No monorepo boilerplate (Turborepo config, workspace.yaml, etc.)
- Contributor onboarding = `git clone && pnpm install && pnpm dev`
- "Finished" product delivered sooner to 13 users

## Phase 2 (deferred) : Migration to monorepo

Once Phase 1 is stable in production (4-6 weeks after Phase 1 delivery), **Phase 2 transforms flat layout toward monorepo** :

```
jay-reach-monorepo/
├── apps/
│   ├── web/                 # Vite app (from Phase 1 src/)
│   └── worker/              # Deno functions (from Phase 1 supabase/functions/)
├── packages/
│   ├── core/                # Pure domain (prospect scoring, enrichment logic)
│   ├── providers/           # Interfaces + implementations (Bouncer, Smartlead, FullEnrich, etc.)
│   ├── db/                  # Migrations + generated Supabase types
│   ├── ui/                  # Shared shadcn components
│   └── config/              # Zod schemas runtime
├── examples/
│   └── standalone/          # Snapshot of Phase 1 flat layout (reference)
├── docs/
├── pnpm-workspace.yaml      # Workspace declaration
├── turbo.json               # Task orchestration
└── package.json             # Root workspace manifest
```

**Phase 2 advantages** :
- Extraction of npm packages (`@jay-reach/core`, `@jay-reach/providers`, etc.)
- Dual-distribution active : Jay (SaaS app) consumes these packages
- Community contributions bring value directly to commercial version
- Separation of concerns : core logic isolated from UI specifics

## Phase 1 → Phase 2 Migration

The transition is **mechanical** :

1. Create new monorepo `jay-reach-monorepo`
2. `apps/web/` = copy of Phase 1 `src/` + import adaptation (`@jay-reach/ui` instead of `../components`)
3. `apps/worker/` = copy of Phase 1 `supabase/functions/` + adaptation
4. `packages/*` = progressive extraction of shared code (core logic → `@jay-reach/core`, providers → `@jay-reach/providers`, etc.)
5. `examples/standalone/` = snapshot of Phase 1 flat layout (for reference and backward compat)
6. Jay app migration : replace local imports with npm dependencies (`import { ICP } from '@jay-reach/core'`)

**Estimated duration** : 2-3 weeks (extraction + tests + validation).

## Multi-tenancy : Phase 1 or Phase 2 ?

ADR 0003 (multi-tenant via `workspace_id`) is **orthogonal** to this phasing.

**Decision** : Multi-tenancy starts in **Phase 1**.

Why :
- SaaS model depends on multi-tenant (each client = workspace)
- OSS self-host also benefits from multi-tenant (1 workspace = 1 dev/agency, extensible)
- Implementing in Phase 1 = single DB migration, single set of RLS policies
- ADR 0003 describes complete strategy (tables, RLS, data migration) independently of flat vs. monorepo structure

**Impact** : Multi-tenant is in flat layout Phase 1. Phase 2 simply keeps DB structure unchanged.

## Consequences

### Phase 1 Positives

- **Fast delivery** to 13 users (~4 weeks)
- **Early feedback** : users test real interface, report bugs
- **No "magic" monorepo** upfront : contributors discover complexity gradually
- **Flexible** : can refine Phase 1 scope (ex: drop TanStack Table if too complex, add in Phase 2)
- **True MVP** : product works end-to-end, ready for use

### Phase 1 Negatives

- **Structure to refactor** in Phase 2 (mechanical work but ~2-3 weeks)
- **No Turborepo build optimization** upfront (first build slightly slower, don't care)
- **Local imports** instead of npm packages (not a problem in private phase)

### Phase 2 Positives

- **Published npm packages** : community can use standalone
- **Dual-distribution sealed** : Jay SaaS consumes `@jay-reach/core` as npm dependency
- **Long-term maintenance** : single source of truth (public repo)

### Phase 2 Negatives

- **Coupled migration** : Jay transitions from refactored code (Phase 1) to npm packages (Phase 2). Two major migrations back-to-back.
- **Architecture shift visible** to 13 users (but controlled, it's ok)

## Phase Sequencing

### Phase 0 (Setup) — Now (2 weeks)
- [ ] Repo `jay-reach` created (DONE)
- [ ] OSS governance (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, etc.) — THIS TASK
- [ ] ADRs copied and clarified (0001-0009)
- [ ] Basic GitHub Actions CI/CD
- [ ] Initial README

**Phase 0 output** : Repo ready-to-merge, governance in place.

### Phase 1 (Refactor in-place Jay + flat layout extraction) — 6 weeks
- [ ] Multi-tenant refactor in Jay (4-5 weeks, progressively merged to main Jay)
- [ ] Extract refactored code to `jay-reach` flat layout (1 week)
- [ ] Reader-friendly documentation (README, GETTING_STARTED, architecture)
- [ ] CI green (lint, type-check, build, test:run)
- [ ] Demo mode functional (mocks providers, example seedata)
- [ ] Release v0.1.0-alpha

**Phase 1 output** : 13 users can `git clone`, `pnpm install`, `pnpm dev`, explore app.

### Phase 2 (Monorepo + npm packages) — 4-6 weeks after Phase 1
- [ ] Migrate to monorepo (2-3 weeks)
- [ ] Extract npm packages (1-2 weeks)
- [ ] Publish `@jay-reach/*` to npm registry
- [ ] Migrate Jay SaaS to npm packages (2 weeks)
- [ ] Release v0.2.0-beta

**Phase 2 output** : Community can install packages standalone, Jay SaaS consumes from npm.

### Phase 3+ (Long-term)
- OSS public (FSL-1.1-MIT active)
- Community contributions
- Double improvements (OSS + SaaS)
- Stable v1.0

## Alternatives Rejected

### Alt 1 : Monorepo from Phase 1

Rejected. Too much boilerplate, slows Phase 1 delivery.

### Alt 2 : Flat layout indefinitely

Rejected. Multi-tenant and npm packages require monorepo long-term to avoid divergence.

### Alt 3 : Multi-tenant in Phase 2

Rejected. Jay SaaS depends on multi-tenant, implement from Phase 1 to validate early.

## References

- **ADR 0001** : Dual-distribution Open Core
- **ADR 0002** : Monorepo pnpm + Turborepo
- **ADR 0003** : Multi-tenant via workspace_id
- **ADR 0006** : Refactor in-place then extraction
- **ADR 0007** : Technical stack
- **ADR 0008** : FSL-1.1-MIT licensing

## Notes for Contributors

If you clone the repo in Phase 1 and see a "surprisingly simple" structure (flat layout), it's intentional. The monorepo arrives in Phase 2. In the meantime, the code is monolithic but **modular** (isolated features, clear boundaries), easy to navigate and contribute to.

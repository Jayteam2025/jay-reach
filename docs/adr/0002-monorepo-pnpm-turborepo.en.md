# ADR 0002 : Monorepo pnpm + Turborepo (Phase 2)

**[FR]** Voir [0002-monorepo-pnpm-turborepo.md](./0002-monorepo-pnpm-turborepo.md)

- **Status** : Accepted (Phase 2, currently deferred)
- **Date** : 2026-05-19
- **Last Updated** : 2026-06-16
- **Note** : Target structure for **Phase 2 only**. Phase 1 = flat layout. See ADR 0009.

## Context

In **Phase 2**, Jay Reach will contain :
- A React frontend app (UI)
- A Deno backend app (edge functions)
- Shared code (types, Zod schemas, domain logic, providers, UI components)
- Publishable npm packages (`@jay-reach/core`, `@jay-reach/providers`, etc.)

**Phase 1 (current)** uses a flat layout. This ADR describes the **Phase 2 target structure** only.

## Decision

**Phase 2 : Monorepo** managed by **pnpm workspaces + Turborepo**.

Structure :

```
jay-reach/
├── apps/
│   ├── web/                    # Vite + React
│   └── worker/                 # Deno edge functions
├── packages/
│   ├── core/                   # Pure domain (zero IO)
│   ├── providers/              # Interfaces + external impls
│   ├── db/                     # Migrations + Supabase types
│   ├── ui/                     # Shadcn shared components
│   └── config/                 # Zod schemas runtime
├── examples/
├── docs/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### Why pnpm

- **Strict by default** : avoids wild `node_modules` hoisting (common pitfall)
- **Native workspaces** : simple `pnpm-workspace.yaml` + `workspace:*` in `package.json`
- **Disk-efficient** : single global store, hardlinks
- **Fast** : 2-3x faster than npm/yarn classic in CI
- **2026 standard** for serious monorepos

### Why Turborepo

- **Remote cache** (optional) : can self-host or use Vercel Cache
- **Parallel pipelines** : `turbo run build` executes independent builds in parallel
- **Topological awareness** : knows build order
- **Incremental** : only rebuilds what changed
- **Simple config** : declarative `turbo.json`

### Package naming convention

- Internal packages : `@jay-reach/core`, `@jay-reach/providers-bouncer`, `@jay-reach/db`, etc.
- `@jay-reach` scope for disambiguation and future npm publication

## Phase 1 : Flat layout (transition toward monorepo)

**Phase 1 (current, ~6 weeks)** deploys a **flat layout** for fast delivery :
```
jay-reach/
├── src/                    # Vite + React app
├── supabase/               # Deno edge functions
├── docs/
└── scripts/
```

Code is **modularly structured** to ease Phase 2 extraction :
- `src/features/` isolates domains (prospection, enrichment, messaging)
- `src/lib/` groups reusable logic
- `supabase/functions/_shared/` = code shared between edge functions

## Phase 2 : Migration to monorepo

After Phase 1 is stable (~4-6 weeks later), Phase 2 refactors toward the monorepo :
1. Copy `src/` → `apps/web/src/`
2. Copy `supabase/functions/` → `apps/worker/`
3. Extract `src/lib/` and domains → `packages/core/`, `packages/providers/`, `packages/ui/`
4. Setup Turborepo + pnpm workspaces
5. Publish npm packages (`@jay-reach/*`)
6. Migrate Jay SaaS toward npm imports (Phase 2 item)

## Consequences

### Positives

- Code sharing between web and worker without `npm link` or manual packaging
- Atomic cross-package refactors (single commit, single PR)
- Fast CI thanks to Turbo cache
- Excellent dev ergonomics (single `pnpm install` at root)
- 2026 industry standard, no surprises for new contributors

### Negatives

- Heavier initial setup than single repo (multi-package TS config, multi-package ESLint)
- Contributors need to understand pnpm workspaces (minimal but real learning curve)
- First build without cache is slower
- Risk of cross-package coupling if rules not enforced (mitigated by ESLint rules + Turborepo task graph)

## Alternatives Considered

### Alt 1 : npm/yarn workspaces

Rejected. pnpm is better on all axes (strict, perf, disk).

### Alt 2 : Nx instead of Turborepo

Rejected. Nx is more feature-rich but much more complex and opinionated. Turborepo is sufficient and simpler to adopt.

### Alt 3 : Polyrepos (one repo per app/package)

Rejected. Version divergence, painful cross-repo refactors, complex CI orchestration, contributor fragmentation.

### Alt 4 : Lerna

Rejected. Old school, less maintained, replaced by Turborepo/pnpm in modern ecosystem.

## References

- Turborepo docs : https://turbo.build/repo/docs
- pnpm workspaces : https://pnpm.io/workspaces
- Vercel monorepo example : https://github.com/vercel/next.js
- Cal.com monorepo structure : https://github.com/calcom/cal.com
- **ADR 0009** : Standalone-first Phasing (Phase 1 flat, Phase 2 monorepo)

# ADR 0002 : Monorepo pnpm + Turborepo

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

Jay Reach contient au minimum :
- Une app frontend React (UI)
- Une app backend Deno (edge functions, workers)
- Du code partage entre les deux (types, schemas Zod, domain logic, providers, ui components)

Question : monorepo ou polyrepos ?

## Decision

**Monorepo** gere par **pnpm workspaces + Turborepo**.

Structure :

```
jay-reach/
├── apps/
│   ├── web/                    # Vite + React
│   └── worker/                 # Deno edge functions
├── packages/
│   ├── core/                   # Domain pur (zero IO)
│   ├── providers/              # Interfaces + impls externes
│   ├── db/                     # Migrations + types Supabase
│   ├── ui/                     # Shadcn shared components
│   └── config/                 # Zod schemas runtime
├── examples/
├── docs/
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### Pourquoi pnpm

- **Strict** par defaut : evite les `node_modules` hoist sauvages (frequent piege)
- **Workspaces natifs** simples : `pnpm-workspace.yaml` + `workspace:*` dans les `package.json`
- **Disk-efficient** : un seul store global, hardlinks
- **Fast** : 2-3x plus rapide que npm/yarn classic en CI
- **Standard 2026** pour les monorepos serieux

### Pourquoi Turborepo

- **Cache distant** (option) : on peut self-hoster le cache ou utiliser Vercel Cache
- **Pipelines paralleles** : `turbo run build` execute en parallele les builds independants
- **Topological awareness** : sait dans quel ordre builder les packages
- **Incremental** : ne rebuild que ce qui a change
- **Simple a configurer** : un `turbo.json` declaratif

### Convention naming des packages

- Packages internes : `@jay-reach/core`, `@jay-reach/providers-bouncer`, `@jay-reach/db`, etc.
- Scope `@jay-reach` pour disambiguation et future publication npm si pertinent

## Consequences

### Positives

- Code share entre web et worker sans `npm link` ni packaging manuel
- Refactors cross-packages atomic (un seul commit, une seule PR)
- CI rapide grace au cache Turbo
- Ergonomie dev excellente (un seul `pnpm install` a la racine)
- Standard de l'industrie en 2026, pas de surprise pour les nouveaux contributeurs

### Negatives

- Setup initial plus lourd qu'un repo simple (config TS multi-package, ESLint multi-package)
- Necessite que les contributeurs comprennent pnpm workspaces (apprentissage minimal mais existant)
- Premier build sans cache est plus long
- Risque de coupling cross-packages si les regles ne sont pas enforcees (mitige par ESLint rules + Turborepo task graph)

## Alternatives considerees

### Alt 1 : npm/yarn workspaces

Rejete. pnpm est meilleur sur tous les axes (strict, perf, disque).

### Alt 2 : Nx au lieu de Turborepo

Rejete. Nx est plus complet mais beaucoup plus complexe et opinionated. Turborepo suffit pour notre besoin et est plus facile a adopter.

### Alt 3 : Polyrepos (un repo par app/package)

Rejete. Divergence des versions, refactors cross-repo penibles, CI orchestration complexe, fragmentation des contributeurs.

### Alt 4 : Lerna

Rejete. Old school, moins maintenu, remplace par Turborepo/pnpm dans l'ecosystem moderne.

## Migration depuis Jay

Pendant la Phase 1 (refactor in-place dans Jay), on **n'a pas encore le monorepo**. On structure le code dans `src/features/prospection/` et `supabase/functions/prospect/_packages/` en singeant la structure cible pour rendre l'extraction Phase 2 mecanique.

## References

- https://turbo.build/repo/docs
- https://pnpm.io/workspaces
- Vercel monorepo : https://github.com/vercel/next.js (exemple de reference)
- Cal.com monorepo structure : https://github.com/calcom/cal.com

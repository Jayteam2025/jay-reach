# ADR 0002 : Monorepo pnpm + Turborepo (Phase 2)

- **Statut** : Accepted (Phase 2, actuellement différée)
- **Date** : 2026-05-19
- **Dernière mise à jour** : 2026-06-16
- **Note** : Structure cible pour **Phase 2** uniquement. Phase 1 = layout plat. Voir ADR 0009.

## Contexte

En **Phase 2**, Jay Reach devra contenir :
- Une app frontend React (UI) 
- Une app backend Deno (edge functions)
- Du code partagé (types, schemas Zod, domain logic, providers, composants UI)
- Des packages npm publiables (`@jay-reach/core`, `@jay-reach/providers`, etc.)

**Phase 1 (actuelle)** utilise un layout plat. Cette ADR décrit la structure **cible Phase 2** seulement.

## Decision

**Phase 2 : Monorepo** géré par **pnpm workspaces + Turborepo**.

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

## Phase 1 : Layout plat (transition vers monorepo)

**Phase 1 (actuelle, ~6 semaines)** déploie un layout **plat** pour livraison rapide :
```
jay-reach/
├── src/                    # App Vite + React
├── supabase/               # Edge Functions Deno
├── docs/
└── scripts/
```

Le code est **structuré modulairement** pour faciliter l'extraction Phase 2 :
- `src/features/` isolent les domaines (prospection, enrichment, messaging)
- `src/lib/` regroupe la logique réutilisable
- `supabase/functions/_shared/` = code partagé entre edge functions (sans module/import structuré)

## Phase 2 : Migration vers monorepo

Après Phase 1 stable (~4-6 semaines), la Phase 2 refactore vers le monorepo :
1. Copier `src/` → `apps/web/src/`
2. Copier `supabase/functions/` → `apps/worker/`
3. Extraire `src/lib/` et domaines → `packages/core/`, `packages/providers/`, `packages/ui/`
4. Setup Turborepo + pnpm workspaces
5. Publier packages npm (`@jay-reach/*`)
6. Migration Jay SaaS vers imports npm (Phase 2 item)

## References

- https://turbo.build/repo/docs
- https://pnpm.io/workspaces
- Vercel monorepo : https://github.com/vercel/next.js (exemple de reference)
- Cal.com monorepo structure : https://github.com/calcom/cal.com

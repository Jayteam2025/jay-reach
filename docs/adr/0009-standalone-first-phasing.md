# ADR 0009 : Phasing Standalone-first (Phase 1 en plat, intégration multi-tenant différée)

- **Statut** : Accepted (Source of Truth pour phasing)
- **Date** : 2026-06-16
- **Dernière mise à jour** : 2026-06-16
- **Decideurs** : Alexandre De Clercq, Jean-Baptiste Renart
- **Supersedes** : ADR 0001 et 0002 pour la Phase 1 (remplacés par flat layout)

## Contexte

Les ADR 0001 et 0002 décrivaient une stratégie ambitieuse :
- ADR 0001 : OSS + SaaS sur le même code (dual-distribution)
- ADR 0002 : Monorepo pnpm + Turborepo dès le départ

Lors de la planification de Phase 1 (extraction de Jay Reach hors du monorepo Jay), on s'est rendu compte que **livrer immédiatement une structure monorepo complexe ralentirait l'arrivée du produit aux 13 utilisateurs initiaux**. Une **structure à plat (flat layout)** permet une livraison plus rapide en Phase 1, avec l'intégration multi-tenant+monorepo différée à Phase 2.

## Decision

Pour **Phase 1 (livraison OSS initiale)**, le repo Jay Reach démarre en **structure à plat** (flat layout) :

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
│   │   ├── _shared/         # Modules partagés Deno
│   │   └── ...
│   ├── migrations/          # SQL migrations
│   └── types.ts             # Types Supabase générés
├── scripts/
├── docs/
├── .github/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

**Avantages Phase 1 flat layout** :
- Setup simple, 0 friction pour le clone/install initial
- Pas de monorepo boilerplate (Turborepo config, workspace.yaml, etc.)
- Onboarding contributeur = `git clone && pnpm install && pnpm dev`
- Produit "fini" livré plus tôt aux 13 utilisateurs

## Phase 2 (différée) : Migration vers monorepo

Une fois Phase 1 stable en production (4-6 semaines après la Phase 1 delivery), **Phase 2 transforme le flat layout vers le monorepo**:

```
jay-reach-monorepo/
├── apps/
│   ├── web/                 # Vite app (contenu de src/ Phase 1)
│   └── worker/              # Deno functions (contenu de supabase/functions/ Phase 1)
├── packages/
│   ├── core/                # Domain pur (prospect scoring, enrichment logic)
│   ├── providers/           # Interfaces + implementations (Bouncer, Smartlead, FullEnrich, etc.)
│   ├── db/                  # Migrations + types Supabase générés
│   ├── ui/                  # Composants shadcn partagés
│   └── config/              # Zod schemas runtime
├── examples/
│   └── standalone/          # Copie flat layout Phase 1 (reference)
├── docs/
├── pnpm-workspace.yaml      # Workspace declaration
├── turbo.json               # Task orchestration
└── package.json             # Root workspace manifest
```

**Avantage Phase 2** :
- Extraction de packages npm (`@jay-reach/core`, `@jay-reach/providers`, etc.)
- Dual-distribution active : Jay (app SaaS) consomme ces packages
- Contributions communautaires apportent du value directement à la version commerciale
- Separation of concerns : core logic isolée des spécificités UI

## Migration Phase 1 → Phase 2

Le passage est **mécanique** :

1. Créer le nouveau monorepo `jay-reach-monorepo`
2. `apps/web/` = copie de `src/` + adaptation imports (`@jay-reach/ui` au lieu de `../components`)
3. `apps/worker/` = copie de `supabase/functions/` + adaptation
4. `packages/*` = extraction progressive du code partagé (core logic → `@jay-reach/core`, providers → `@jay-reach/providers`, etc.)
5. `examples/standalone/` = snapshot du flat layout Phase 1 (à titre de référence et backward compat)
6. Migration Jay (app) : remplacer les imports locaux par les dépendances npm (`import { ICP } from '@jay-reach/core'`)

**Durée estimée** : 2-3 semaines (extraction + tests + validation).

## Multi-tenancy : Phase 1 ou Phase 2 ?

ADR 0003 (multi-tenant via `workspace_id`) est **orthogonal** à ce phasing.

**Décision** : Multi-tenancy commence en **Phase 1**.

Pourquoi :
- Le modèle SaaS Jay dépend de multi-tenant (chaque client = workspace)
- L'OSS self-host bénéficie aussi de multi-tenant (1 workspace = 1 dev/agence, extensible)
- Implémenter en Phase 1 = une seule migration DB, une seule set de RLS policies
- ADR 0003 décrit la stratégie complète (tables, RLS, migration data) indépendamment de la structure flat vs. monorepo

**Impact** : Multi-tenant est dans le flat layout Phase 1. Phase 2 garde simplement la structure DB inchangée.

## Consequences

### Positives Phase 1

- **Livraison rapide** aux 13 users (~4 semaines)
- **Feedback précoce** : les users testent la vraie interface, rapportent des bugs
- **Pas de "magic" monorepo** au départ : contributeurs découvrent graduellement la complexité
- **Flexible** : on peut affiner le scope Phase 1 (ex: drop TanStack Table si trop complexe, l'ajouter Phase 2)
- **Vrai MVP** : le produit fonctionne de bout en bout, prêt à l'usage

### Negatives Phase 1

- **Structure à refactoriser** en Phase 2 (travail mécanique mais ~2-3 semaines)
- **Pas d'optimisation build Turborepo** au départ (premier build un peu lent, on s'en fout)
- **Imports locaux** au lieu de npm packages (pas grave en phase privée)

### Positives Phase 2

- **Packages npm publiés** : la communauute peut les utiliser standalone
- **Dual-distribution scellée** : Jay SaaS consomme `@jay-reach/core` comme dépendance npm
- **Maintenance long-terme** : une seule source de vérité (le repo public)

### Negatives Phase 2

- **Migration couplée** : Jay passe de la version refactée (Phase 1) vers les packages npm (Phase 2). Deux grandes migrations back-to-back.
- **Changement d'architecture visible** pour les 13 users (mais c'est contrôlé, c'est ok)

## Sequencing des Phases

### Phase 0 (Setup) — Maintenant (2 semaines)
- [ ] Repo `jay-reach` créé (FAIT)
- [ ] Governance OSS (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, etc.) — THIS TASK
- [ ] ADRs copiés et clarifiés (0001-0009)
- [ ] CI/CD GitHub Actions basique
- [ ] README initial

**Sortie Phase 0** : Repo ready-to-merge, governance en place.

### Phase 1 (Refactor in-place Jay + extraction flat layout) — 6 semaines
- [ ] Multi-tenant refactor dans Jay (4-5 semaines, mergé progressivement sur main Jay)
- [ ] Extraction du code refactorisé vers `jay-reach` flat layout (1 semaine)
- [ ] Documentation reader-friendly (README, GETTING_STARTED, architecture)
- [ ] CI verte (lint, type-check, build, test:run)
- [ ] Mode démo fonctionnel (mocks providers, seedata exemple)
- [ ] Release v0.1.0-alpha

**Sortie Phase 1** : 13 users peuvent `git clone`, `pnpm install`, `pnpm dev`, explorer l'app.

### Phase 2 (Monorepo + packages npm) — 4-6 semaines après Phase 1
- [ ] Migration vers monorepo (2-3 semaines)
- [ ] Extraction packages npm (1-2 semaines)
- [ ] Publish `@jay-reach/*` sur npm registry
- [ ] Migration Jay SaaS vers packages npm (2 semaines)
- [ ] Release v0.2.0-beta

**Sortie Phase 2** : Communauté peut installer packages standalone, Jay SaaS consomme depuis npm.

### Phase 3+ (Long-terme)
- OSS public (FSL-1.1-MIT active)
- Contributions communautaires
- Améliorations doubles (OSS + SaaS)
- Version 1.0 stable

## Alternatives rejetées

### Alt 1 : Monorepo dès Phase 1

Rejete. Trop de boilerplate, ralentit la livraison Phase 1.

### Alt 2 : Flat layout indéfiniment

Rejete. Multi-tenant et packages npm demand monorepo long-terme pour éviter la divergence.

### Alt 3 : Multi-tenant en Phase 2

Rejete. Le SaaS Jay dépend de multi-tenant, on l'implémenter dès Phase 1 pour valider au plus tôt.

## References

- ADR 0001 : dual-distribution Open Core
- ADR 0002 : monorepo pnpm + Turborepo
- ADR 0003 : multi-tenant via workspace_id
- ADR 0006 : refactor in-place puis extraction
- ADR 0007 : stack technique

## Notes pour les contributeurs

Si vous clonez le repo en Phase 1 et voyez une structure "étonnamment simple" (flat layout), c'est intentionnel. Le monorepo arrive en Phase 2. En attendant, le code est monolithique mais **modulaire** (features isolées, clear boundaries), facile à naviguer et à contribuer.

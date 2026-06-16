# ADR 0006 : Refactor in-place dans Jay avant extraction physique

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

Pour creer Jay Reach, deux strategies possibles :

1. **Big bang extraction** : copier le code prospection vers un nouveau repo, refactorer la-bas, deconnecter de Jay
2. **Refactor in-place puis extraction** : refactorer le code dans Jay, le rendre extractible (boundaries propres), puis extraire physiquement

Le code prospection est en production critique pour Jay. On envoie des emails reels via Smartlead, on facture l'activite. Un big bang risque de casser la prod.

## Decision

**Strategie en 2 etapes :**

### Etape 1 : Refactor IN-PLACE dans le repo Jay (5-6 semaines)

Travailler dans le worktree `.worktrees/jay-reach` sur la branche `feat/jay-reach-refactor`. Mergent progressivement sur `main` Jay via PRs incrementales.

A la fin de cette etape :
- Multi-tenant fonctionnel (Jay devient "workspace Jay" parmi d'autres potentiels)
- ICP profiles editables (la config Jay est seedée mais editable comme les autres)
- Templates userland (le pitch Jay est dans `workspace_brand`, plus dans les prompts)
- Providers abstraits (FullEnrich/Bouncer/Smartlead passent par interfaces + resolver)
- God components decoupes
- Tests sur les invariants critiques
- Modules `_shared/` organises dans une structure proche du futur monorepo

**Jay tourne en prod tout du long.** Chaque PR est revue, deployée sur staging, validée, puis sur prod. On ne casse rien.

### Etape 2 : Extraction PHYSIQUE vers le repo public (2 semaines)

Une fois le refactor in-place valide en prod Jay, on extrait :

1. Creation du repo public `Jayteam2025/jay-reach` (private d'abord, public ensuite)
2. Setup monorepo pnpm + Turborepo
3. Copie du code prospection refactor vers la nouvelle structure (`apps/web/src/features/`, `apps/worker/`, `packages/*`)
4. Adaptation : Jay specifics deviennent un exemple dans `examples/jay-config/`
5. Setup CI GitHub Actions
6. Documentation (README, CONTRIBUTING, ARCHITECTURE)
7. Premier release `v0.1.0-alpha`
8. **Jay continue d'utiliser le code in-place pendant un temps** (transition douce)

### Etape 3 : Bascule de Jay vers les packages `@jay-reach/*`

C'est le **mode cible final**, decide validement le 2026-05-19 : Jay (l'app commerciale) consomme Jay Reach **comme dependances npm** plutot que de garder une copie locale. Pas optionnel.

Une fois les packages `@jay-reach/core`, `@jay-reach/providers`, `@jay-reach/db`, `@jay-reach/ui` publies (Phase 2), on bascule progressivement les imports cote Jay :

1. **Phase 2 fin** : premiere publication des packages (versions `0.1.0-alpha`)
2. **Transition** : Jay garde sa copie in-place ET commence a importer les packages module par module
3. **Stabilisation** : a chaque module bascule, on supprime le code local correspondant dans Jay
4. **Mode cible atteint** : Jay n'a plus que des imports depuis `@jay-reach/*`, le code local prospection est entierement supprime

**Avantage du mode cible** : une seule source de verite (le repo public). Pas de divergence possible entre la version OSS et la version Jay-commerciale. Les ameliorations faites par la communaute beneficient Jay automatiquement (via `npm update`), et inversement.

**Versioning** : semver strict (`major.minor.patch`). Jay declare ses dependances avec des ranges precis (`"@jay-reach/core": "^0.5.0"` jusqu'a v1.0, puis `"^1.0.0"` apres stabilisation API).

## Pourquoi pas big bang

- **Risque casse prod Jay** : le code prospection est utilise tous les jours, on envoie des emails
- **Visibilite progres** : 6 semaines de "trust me bro" sans validation = anxiete
- **Decouplage emerge** : on apprend les vrais points de couplage en refactorant en place
- **Backup naturel** : le repo Jay garde tout, on peut revert facilement
- **Pas de double DB** : meme Supabase pendant le refactor, on migre que le code

## Pourquoi pas "refactor + extraction simultanee"

Trop complexe a coordonner. Soit on refactore, soit on deplace. Pas les deux en meme temps.

## Consequences

### Positives

- **Jay reste stable en prod** pendant tout le refactor
- **Validation incrementale** : chaque PR est testable independamment
- **Apprentissage** : on decouvre les vrais couplages au fur et a mesure
- **Bascule douce** : Jay Reach peut etre publie alpha sans pression "tout doit marcher"
- **Reversible** : si on decide d'abandonner Jay Reach, le refactor in-place a quand meme ameliore Jay

### Negatives

- **Plus long total** : refactor + extraction = ~8 semaines vs big bang ~5 semaines (mais le big bang risque la prod)
- **Mental load** : on a deux structures dans la tete (Jay actuelle + cible Jay Reach)
- **Risque de "ca marche dans Jay donc on extrait pas"** : il faut une echeance ferme pour la Phase 2
- **Code mort temporaire** : pendant la Phase 1, on a des structures cibles qui ne sont pas utilisees ailleurs

## Mitigations

- **Echeance ferme Phase 1 -> Phase 2** : 6 semaines max sur Phase 1, sinon on simplifie le scope
- **Definition of Done** par sous-phase : critere precis "cette sous-phase est terminee quand X est verifie en prod"
- **Worktree dedie** : `.worktrees/jay-reach` evite le melange avec d'autres travaux Jay
- **Branche longue duree** : `feat/jay-reach-refactor` reste vivante mais on merge des sous-PRs regulierement

## Sequencing des sous-PRs (Phase 1)

Ordre conseille (chaque etape merge sur main Jay avant de passer a la suivante) :

1. **1.1** : Multi-tenant (workspaces, workspace_members, RLS pattern) - **3 PRs successives**
2. **1.2** : ICP profiles table + migration enum -> FK - **2 PRs**
3. **1.3** : workspace_brand table + sortie du Jay-pitch des prompts - **2 PRs**
4. **1.4** : Provider interfaces + refactor Bouncer/Smartlead/FullEnrich - **3 PRs**
5. **1.5** : Decoupage EntrepriseFiche.tsx + ProspectionEntreprises.tsx - **3-5 PRs**
6. **1.6** : Tests invariants (gate, scoring, pattern learning) - **2 PRs**
7. **1.7** : Zod schemas aux frontieres + types stricts - **1-2 PRs**

Total estime : ~16-19 PRs sur 5-6 semaines.

## Alternatives considerees

### Alt 1 : Big bang extraction (forker prospection)

Rejete (voir contexte).

### Alt 2 : Refactor sans extraction (juste ameliorer dans Jay)

Rejete : on ne servirait pas les 13 personnes interessees, pas de canal OSS, pas de SaaS futur.

### Alt 3 : Extraction puis refactor (extraire d'abord, nettoyer dans le nouveau repo)

Rejete : Jay continue d'utiliser le code, donc on aurait deux endroits a synchroniser. Cauchemar.

## Critere de fin de Phase 1

La Phase 1 est terminee quand :

- [ ] Jay tourne en prod sur la nouvelle architecture multi-tenant
- [ ] Aucune valeur "Jay-specific" n'est plus dans le code (tout est en DB workspace_*)
- [ ] Les 5 blockers identifies dans l'audit sont resolus
- [ ] Tests CI passent (lint, type-check, test:run, build)
- [ ] Tests d'invariants critiques sont verts (gate Smartlead, scoring, pattern learning)
- [ ] Mode demo fonctionne sans aucune cle API
- [ ] Documentation interne a jour (`docs/jay-reach/architecture-cible.md` reflete la realite)

Quand ces criteres sont coches, on declenche la Phase 2.

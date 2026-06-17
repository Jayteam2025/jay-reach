# ADR 0006 : Stratégie de refactoring et extraction (Phase 1 terminée)

- **Statut** : Accepted (appliquée et complétée)
- **Date** : 2026-05-19
- **Dernière mise à jour** : 2026-06-16
- **Note** : Documentation historique. L'extraction a eu lieu. Voir ADR 0009 pour le phasing actuel.

## Contexte historique

Lors de la conception (mai 2026), deux approches étaient envisagées :

1. **Big bang extraction** : copier le code prospection hors de Jay, refactorer dans le nouveau repo
2. **Refactor in-place puis extraction** : refactorer d'abord dans Jay, puis extraire

L'approche 2 a été choisie pour minimiser le risque de régression en production Jay.

## Décision et exécution

**Stratégie : Refactor in-place dans Jay, puis extraction progressive vers repo public.**

### Exécution (statut 2026-06-16)

**Refactor in-place** : Complété avec succès. Le code prospection dans Jay a été transformé pour :
- Multi-tenant workspace-based (ADR 0003)
- ICP profiles éditables (ADR 0004)
- Providers abstraits (ADR 0005)
- Architecture modulaire (prep extraction)

**Extraction physique** : Effectuée. Le repo `Jayteam2025/jay-reach` a été créé en tant que **repo public OSS indépendant** (Phase 1, layout plat).

**Mode cible futur (Phase 2)** : Après stabilisation Phase 1 (~6 semaines), Jay Reach migrerait vers une structure monorepo avec packages npm (`@jay-reach/core`, `@jay-reach/providers`, etc.) que Jay (l'app SaaS) consommerait comme dépendances (voir ADR 0009 pour le phasing).

## Principes clés

- **Une seule source de vérité** : le code métier ne diverge pas entre OSS et SaaS
- **Multi-tenant dès le départ** : supporté en Phase 1 (OSS et SaaS)
- **Pas de secrets hardcodés** : providers abstraits + BYOK (ADR 0005)
- **Layout flat puis monorepo** : simplifier Phase 1, complexifier Phase 2 (ADR 0009)

## Références

- **ADR 0009** : Phasing Standalone-first (Phase 1 et 2)
- **ADR 0002** : Structure monorepo (cible Phase 2)
- **ADR 0003-0005** : Décisions appliquées pendant refactor

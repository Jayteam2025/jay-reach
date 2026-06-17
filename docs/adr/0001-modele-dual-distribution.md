# ADR 0001 : Modele dual-distribution (OSS + SaaS sur meme code)

- **Statut** : Superseded by ADR 0009 (Standalone-first Phasing)
- **Date** : 2026-05-19
- **Decideurs** : Alexandre De Clercq, Jean-Baptiste Renart

## Note historique

Cette ADR décrivait l'intention initiale : une **structure monorepo avec packages npm dual-distribution** (`@jay-reach/*`) servée à la fois en OSS self-host et au SaaS Jay.

**Décision révisée (2026-06-16 via ADR 0009)** : 
- **Phase 1** (actuelle, 6 semaines) : layout **plat** (flat), pas de monorepo, livraison rapide aux 13 utilisateurs
- **Phase 2** (différée, 4-6 semaines après Phase 1) : migration vers monorepo + packages npm

Les principes restent valides :
- Une seule source de vérité (code métier dans le repo public)
- Pas de divergence entre OSS et SaaS
- Dual-distribution Open Core en Phase 2

Pour la **stratégie complète et à jour**, voir **ADR 0009** (phasing) et **ADR 0002** (structure monorepo Phase 2).

## Principes conservés

- Un seul backlog, une seule équipe de dev
- Pas de features cachées dans l'OSS
- Providers abstraits (BYOK) et multi-tenant dès Phase 1
- Licensing FSL-1.1-MIT (voir ADR 0008)

## Références

- **ADR 0009** : Phasing Standalone-first (Phase 1 flat, Phase 2 monorepo)
- **ADR 0002** : Structure monorepo + Turborepo (cible Phase 2)
- **ADR 0003-0005** : Décisions orthoéditions (multi-tenant, ICP, providers) appliquées dès Phase 1

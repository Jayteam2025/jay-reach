# ADR 0001 : Dual-distribution model (OSS + SaaS on same codebase)

**[FR]** Voir [0001-modele-dual-distribution.md](./0001-modele-dual-distribution.md)

- **Status** : Superseded by ADR 0009 (Standalone-first Phasing)
- **Date** : 2026-05-19
- **Decision Makers** : Alexandre De Clercq, Jean-Baptiste Renart

## Historical Note

This ADR described the initial intention: a **monorepo structure with npm packages dual-distribution** (`@jay-reach/*`) served to both OSS self-host and Jay SaaS.

**Revised decision (2026-06-16 via ADR 0009)** :
- **Phase 1** (current, 6 weeks) : **flat layout**, no monorepo, fast delivery to 13 users
- **Phase 2** (deferred, 4-6 weeks after Phase 1) : migration to monorepo + npm packages

Core principles remain valid:
- Single source of truth (business logic in public repo)
- No divergence between OSS and SaaS
- Dual-distribution Open Core in Phase 2

For the **complete and up-to-date strategy**, see **ADR 0009** (phasing) and **ADR 0002** (Phase 2 monorepo structure).

## Retained Principles

- Single backlog, single dev team
- No major features hidden in OSS version
- Abstract providers (BYOK) and multi-tenant from Phase 1
- FSL-1.1-MIT licensing (see ADR 0008)

## References

- **ADR 0009** : Standalone-first Phasing (Phase 1 flat, Phase 2 monorepo)
- **ADR 0002** : Monorepo + Turborepo structure (Phase 2 target)
- **ADR 0003-0005** : Orthogonal decisions (multi-tenant, ICP, providers) applied from Phase 1

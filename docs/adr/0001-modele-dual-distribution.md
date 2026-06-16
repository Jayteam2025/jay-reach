# ADR 0001 : Modele dual-distribution (OSS + SaaS sur meme code)

- **Statut** : Propose
- **Date** : 2026-05-19
- **Decideurs** : Alexandre De Clercq, Jean-Baptiste Renart

## Contexte

Jay Reach est destine a deux publics differents :

1. **13 personnes initialement identifiees** (devs, equipes techniques) qui veulent acceder au code pour leur usage interne. Phase actuelle : **acces invite-only sur repo prive**. Phase future eventuelle : ouverture publique.
2. **Clients commerciaux Jay existants et futurs** qui beneficient de la fonctionnalite Prospection comme partie integrante de leur abonnement Jay, sans avoir a gerer hosting ni cles API.

Nous voulons servir les deux **sans maintenir deux bases de code differentes** (divergence ingerable, double cost, qualite degradee). La version commerciale n'est **pas une app separee** (`jay-reach.com`) mais **l'app Jay actuelle qui consomme les packages `@jay-reach/*`**.

**Important** : on commence le repo en **prive**, pas en public. Decide 2026-05-19 :
- Securite forte (branch protection main, pas de push direct, PR + review obligatoires)
- Pas de licence OSS active tant que c'est prive (les terms GitHub + accord collaborateur suffisent)
- Bascule public differee, decidee plus tard selon la maturite du code

## Decision

On adopte le modele **dual-distribution Open Core** (eprouve par Cal.com, Plane, Documenso, Mautic, Outline, Supabase, Posthog).

Le code de Jay Reach vit dans un **repo GitHub prive (au depart)** `Jayteam2025/jay-reach`, sous forme de packages npm `@jay-reach/*`, consommes par **deux types d'utilisateurs** :

| Aspect | Self-host (13 invites au depart) | App Jay (qui inclut Jay Reach) |
|---|---|---|
| Acces au code | Repo prive GitHub, invitation collaborateur | `npm install @jay-reach/*` dans le package.json Jay (deploye via la registry npm ou directe depuis le repo) |
| Distribution | Clone du repo prive + apps/web standalone pour tester localement | Import des packages publies |
| Hosting | Chez l'utilisateur (Supabase + Deno) | Notre hosting actuel Jay |
| Cles API | BYOK (le user branche les siennes) | Cles mutualisees fournies par Jay |
| Paiement | Gratuit (les invites contribuent) | Inclus dans les plans Jay (Pro, Business, ou add-on) |
| Support | Cercle restreint (Slack/Discord dedie aux invites, ou GitHub Issues privees) | Support Jay existant |
| Branding UI | "Jay Reach" assume | "Prospection" dans le menu Jay (pas de branding Jay Reach visible cote user) |
| Contribution | PR obligatoire, review et merge par equipe Jay uniquement | (code consomme tel quel) |
| Cible | 13 contacts identifies (devs, equipes tech) | Clients Jay existants et futurs |

**Decision sur la visibilite publique : differee**. Le repo reste prive jusqu'a ce qu'on juge le code stable, les invites engages, et le modele rode. Au moment du bascule public, la licence **FSL-1.1-MIT** s'active.

**Une seule source de verite** : tout le code metier vit dans le repo public. L'app Jay consomme les packages comme n'importe quel client npm. Pas de fork, pas de divergence.

**Convention** : aucune feature majeure n'est cachee dans la version OSS. Les packages exposent toutes les capacites. La difference se joue sur :
- L'**ergonomie d'installation** (Jay = 0 clic pour les clients vs OSS = setup Supabase + cles + UI)
- L'**operations** (Jay = on monitore + multi-tenant SaaS vs OSS = vous monitorez votre instance)
- Le **commercial** (Jay = factures, contrat, SLA via les plans Jay vs OSS = aucune obligation)

Si une logique est tres specifique a l'integration dans Jay (ex: branchement aux comptes Jay, lien vers le CRM connecte cote Jay), elle vit dans le code Jay et non dans les packages publics. Les packages restent generiques.

## Consequences

### Positives

- **Une seule equipe de dev, un seul backlog, pas de divergence de versions**
- **Plus de credibility OSS** : les devs voient le vrai code, pas une version castree
- **Marketing organique** : un repo public actif attire des leads pour le SaaS
- **Contributions communautaires** ameliorent directement le SaaS aussi
- **Onboarding talent** : les devs qui veulent rejoindre Jay peuvent voir le code avant
- **Defensibility commerciale** : meme si quelqu'un fork pour vendre un competitor, on a l'expertise et l'historique

### Negatives

- **Discipline architecture necessaire** : tout doit etre concu pour les deux contextes (env vars, providers BYOK, no hardcoded secrets)
- **Risque de fork commercial** : un acteur malveillant peut clone et vendre. Mitigation : on est plus rapide, on a le brand, on a l'expertise.
- **Pressure communaute** : si on ne mergent pas leurs PRs assez vite, ils rouspentent. Mitigation : process clair, expectations gerees dans CONTRIBUTING.md.
- **Charge maintenance** : repondre aux issues, reviewer PRs. Mitigation : prioriser, accepter qu'on ne reponde pas a tout dans la version gratuite.

## Alternatives considerees

### Alt 1 : Deux bases de code separees (OSS = version simplifiee, Cloud = version premium)

Rejete. Divergence ingerable a moyen terme, double cost de maintenance, finit toujours par creer une OSS abandonnware.

### Alt 2 : 100% open source, pas de SaaS

Rejete. On veut commercialiser pour financer le dev et garder une equipe sur le projet. Pas de revenu = pas de produit long terme.

### Alt 3 : 100% proprietaire, pas d'OSS

Rejete. Les 13 personnes interessees veulent du code, pas un SaaS. Et l'OSS est notre meilleur canal d'acquisition.

### Alt 4 : Modele "Source Available" (BSL, SSPL)

Rejete pour V1, a reconsiderer si on subit des forks commerciaux. Trop restrictif pour attirer les contributeurs au depart.

## References

- Cal.com strategy : https://cal.com/blog/we-raised-25m-to-build-cal-com (modele Open Core qui marche)
- Plane.so : repo public + cloud paid
- Documenso : memes prerequis (DocuSign-like en OSS)
- Mautic : Marketing automation OSS + cloud
- HashiCorp model history : ce qu'ils ont rate avec le shift BSL

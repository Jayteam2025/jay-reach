# À LIRE EN PREMIER

Ce dossier est la spécification complète de Jay Reach. Il se dépose tel quel à la racine d'un dépôt vide, et Claude Code s'en sert comme unique source de vérité.

Tout a été arbitré. Vous n'avez pas de décision produit à prendre.

## 1. Mise en place

```bash
mkdir jay-reach && cd jay-reach
git init
# copier ici tout le contenu de ce dossier
git add . && git commit -m "docs: spécification initiale"
claude
```

## 2. Premier message à Claude Code

Copiez-collez exactement ceci, en remplaçant le chemin :

> Lis `CLAUDE.md` puis l'intégralité du dossier `docs/`, dans l'ordre 00 à 12. Ouvre aussi `maquettes/jay-reach-mockups.html` pour comprendre les écrans attendus.
>
> Ensuite exécute le ticket T0 du backlog : l'audit du code existant. Le code à auditer se trouve dans `<chemin local ou URL du dépôt Jay Reach actuel>`.
>
> Tu produis `AUDIT.md` et le dossier `docs/legacy-assets/`, puis tu t'arrêtes. Tu ne modifies rien, tu ne réécris rien.

## 3. Ensuite

Après lecture et validation d'`AUDIT.md` par Alexandre :

> Exécute T1.

Puis T2, T3, et ainsi de suite. Un message par ticket.

## 4. Les quatre points d'arrêt

Claude Code s'arrête et attend une validation humaine sur quatre tickets seulement :

| Ticket | Ce qu'on valide |
|---|---|
| **T0** | Le rapport d'audit et la décision reprendre / repartir à neuf |
| **T13** | Le premier écran complet, validation visuelle |
| **T21** | La file d'attente et la politique d'approbation |
| **T37** | La relecture de sécurité avant de rendre le dépôt public |

Sur tous les autres tickets, Claude Code ne pose pas de question. S'il rencontre un cas non couvert, il choisit l'option la plus conservatrice, l'écrit dans `QUESTIONS.md`, et continue.

## 5. Relire `QUESTIONS.md` à chaque fin de jalon

C'est là que remontent les zones grises. Cinq jalons, donc cinq relectures. Chacune prend dix minutes et évite de découvrir un malentendu trois semaines plus tard.

## 6. Le seul ticket à relire vous-même

**T17, le cœur du séquenceur.** C'est le ticket où un bug ne se voit pas à l'écran mais se voit dans la boîte mail d'un prospect : message envoyé deux fois, relance partie après une réponse, quota dépassé. Ne l'enchaînez pas avec quatre autres tickets d'affilée.

## Contenu du paquet

| Fichier | Rôle |
|---|---|
| `CLAUDE.md` | Règles permanentes lues à chaque session |
| `README.md` | Page publique du dépôt |
| `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` | Fichiers communautaires |
| `LICENSE.md` | Résumé de licence — le texte canonique reste à coller, ticket T37 |
| `CHANGELOG.md` | À compléter à chaque ticket |
| `QUESTIONS.md` | Zones grises rencontrées en route |
| `.env.example` | Variables d'environnement documentées |
| `docs/00-brief-produit.md` | Positionnement, cible, périmètre v1 |
| `docs/01-architecture.md` | Monorepo, sept interfaces, runtime |
| `docs/02-data-model.md` | Schéma Postgres, RLS, rétention |
| `docs/03-sources.md` | Connecteurs de signaux et import de fichiers |
| `docs/04-sequenceur.md` | State machine, canaux, garde-fous |
| `docs/05-messages-et-langues.md` | Versions, variables, trois langues |
| `docs/06-reception-et-reponses.md` | Boîte unifiée, classification des réponses |
| `docs/07-api-et-crm.md` | API publique, webhooks, remontée CRM |
| `docs/08-design-system.md` | Identité et interface |
| `docs/09-maquettes.md` | Lecture des maquettes |
| `docs/10-conformite.md` | RGPD, trois pays, responsabilités |
| `docs/11-audit-legacy.md` | Protocole d'audit du code existant |
| `docs/12-backlog.md` | Tickets ordonnés, jalons 0 à 5 |
| `docs/13-notifications.md` | Email et notification bureau |
| `maquettes/jay-reach-mockups.html` | Cinq écrans applicatifs cliquables |
| `maquettes/landing-jay-reach.html` | Site vitrine, trilingue, deux publics |
| `maquettes/legal/` | Mentions légales, confidentialité, conditions |

## Le dépôt n'est pas vierge

Du code existe déjà et une partie tourne en production sur la prospection réelle de l'éditeur. Ces documents décrivent la cible, pas une table rase.

Conséquence pratique : le ticket T0 n'est pas une formalité. Il identifie ce qui doit continuer à tourner pendant la refonte. Rien n'est supprimé avant validation humaine de son rapport, et un module en usage réel se remplace derrière un drapeau de fonctionnalité, jamais d'un coup.

## Ce qui reste à faire par un humain, pas par l'IA

1. Récupérer le texte canonique de la licence FSL sur <https://fsl.software> et le placer dans `LICENSE`.
2. Créer les adresses `security@jay-reach.fr`, `conduct@jay-reach.fr` et `privacy@jay-reach.fr`.
3. Fournir l'accès au dépôt Jay Reach existant pour l'audit T0, en précisant ce qui tourne en production.
4. Ouvrir les comptes providers et générer les clés listées dans `.env.example`.
5. Recueillir les trois témoignages clients pour le site vitrine — aucune citation ne doit être inventée.
6. Compléter les champs légaux manquants : greffe du RCS, TVA vérifiée sur VIES, hébergeur, téléphone.

# Jay Reach

Moteur de prospection multicanale, self-hosted. Il part d'une raison d'écrire, pas d'une liste à brûler.

Jay Reach détecte ce qui vient de changer chez vos prospects — un recrutement, une nomination, une participation à un salon — ou part de vos propres listes, puis déroule une séquence email, LinkedIn et courrier manuscrit qui cite ce motif.

Vos données restent chez vous. Vos comptes providers restent les vôtres.

---

## Comment ça marche

```
détecter ou importer  →  qualifier  →  enrichir  →  engager  →  répondre
```

**Détecter ou importer.** Des connecteurs surveillent des sources publiques. Ou vous déposez un fichier : directeurs commerciaux d'une verticale, contacts rencontrés sur un salon.

**Qualifier.** Règles puis modèle de langage. Chaque entreprise est rattachée à son identité légale.

**Enrichir.** Entreprise et interlocuteurs complétés : emails vérifiés, profils LinkedIn, adresses d'établissement.

**Engager.** Séquence multicanale, en français, anglais ou néerlandais selon le contact. Le courrier passe toujours par une validation humaine.

**Répondre.** Boîte unifiée email et LinkedIn. Un contact qui répond positivement monte dans votre CRM, avec la conversation et le motif d'origine.

## Installation

```bash
git clone https://github.com/<org>/jay-reach
cd jay-reach
cp .env.example .env
docker compose up
```

L'assistant s'ouvre sur `http://localhost:3000`.

Prérequis : Docker, et une clé pour au moins un enrichisseur et un modèle de langage.

## Ce dont vous avez besoin

Jay Reach n'inclut aucune donnée et aucun quota d'envoi. Vous branchez vos propres comptes.

| Besoin | Providers supportés | Obligatoire |
|---|---|---|
| Sources de signaux | France Travail, Adzuna, Apify | Non si vous importez vos listes |
| Enrichissement contacts | FullEnrich, Dropcontact | Recommandé |
| Identité et adresses d'entreprise | Annuaire légal | Oui pour le courrier |
| Modèle de langage | Anthropic, OpenAI, Ollama | Oui |
| Email | Smartlead | Si canal email |
| LinkedIn | Unipile, mode manuel | Si canal LinkedIn |
| Courrier | Manuscry | Si canal courrier |
| Boîte de réception | Unipile | Recommandé |

Le mode Ollama fait tourner scoring et rédaction entièrement en local : aucune donnée ne sort de votre infrastructure.

## Écrire un connecteur

```bash
pnpm reach:scaffold signal mon-connecteur
```

Deux fonctions à implémenter : `discover()` qui streame les événements, `normalize()` qui les transforme en signaux. Aucune modification du cœur nécessaire.

Guide : [`docs/03-sources.md`](docs/03-sources.md)

## Ce que Jay Reach n'est pas

Pas un CRM — il pousse vers le vôtre. Pas une base de contacts à acheter. Pas un outil d'envoi de masse : les quotas, la validation du courrier et le blocage des messages incomplets sont structurels et ne se désactivent pas.

## À savoir avant de l'utiliser

**Vous êtes responsable de traitement.** Jay Reach est self-hosted : HEY JAY édite le code et n'héberge, ne voit ni ne traite aucune de vos données. Les obligations RGPD liées à votre prospection vous incombent. Jay Reach fournit les outils pour les tenir — accès, effacement, opposition, purge automatique, registre. Voir [`docs/10-conformite.md`](docs/10-conformite.md).

**La boîte de réception ne stocke que ce qui vous concerne.** Un message dont aucun participant ne correspond à un contact de votre base est ignoré et ne laisse aucune trace.

**L'automatisation LinkedIn contrevient aux conditions d'utilisation de la plateforme.** Les API tierces disponibles ne sont pas officielles. Le risque de restriction de compte est réel et vous appartient. Le mode manuel — qui prépare vos actions sans les exécuter — existe pour ceux qui préfèrent ne pas le prendre.

## Licence

**FSL-1.1-ALv2** — Functional Source License, bascule en Apache 2.0 deux ans après chaque publication.

Pour être précis : la FSL n'est pas une licence open source au sens de l'OSI, c'est une licence *fair source*. Le code est public, modifiable et utilisable librement, y compris commercialement pour votre propre prospection. La seule restriction : vous ne pouvez pas en faire un produit concurrent. Après deux ans, chaque version devient Apache 2.0, sans restriction.

## Édité par

[HEY JAY](https://jay-assistant.fr) — Roubaix, France. Le produit vit sur [jay-reach.fr](https://jay-reach.fr).

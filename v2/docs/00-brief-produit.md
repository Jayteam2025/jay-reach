# 00 — Brief produit

## Le problème

La prospection sortante échoue pour une raison simple : elle s'adresse à des gens qui n'ont aucune raison de répondre aujourd'hui. Les outils du marché optimisent le volume et la personnalisation cosmétique. Ils n'optimisent pas le motif de contact.

Jay Reach part de l'autre bout : ce qui déclenche un envoi, c'est une raison légitime d'écrire. Cette raison prend deux formes.

## Les deux natures de source

| | Signal | Liste |
|---|---|---|
| Origine | Événement daté détecté automatiquement | Fichier importé ou constitué à la main |
| Exemple | « Publie une offre de commercial itinérant le 12/08 » | « Directeurs commerciaux de la distribution alimentaire » |
| Fraîcheur | Périssable — la valeur s'effondre avec le temps | Stable |
| Angle du message | Cite le déclencheur et sa date | Cite le contexte commun de la liste |
| Variables disponibles | `{{signal_*}}` | `{{contexte}}` |

Les deux alimentent la même machine : mêmes campagnes, mêmes séquences, mêmes garde-fous. Le code ne doit rien coder en dur qui suppose l'une ou l'autre.

## La boucle

```
détecter ou importer → qualifier → enrichir → engager → répondre
```

1. **Détecter ou importer.** Des connecteurs surveillent des sources publiques ; ou vous déposez un fichier.
2. **Qualifier.** Règles puis modèle de langage. Le signal est rattaché à une entreprise réelle, identifiée par son SIREN.
3. **Enrichir.** Entreprise et interlocuteurs complétés : identité légale, effectifs, emails vérifiés, profils LinkedIn.
4. **Engager.** Séquence multicanale. Chaque message cite sa raison d'être.
5. **Répondre.** Les réponses arrivent dans une boîte unifiée. Un contact qui a répondu positivement monte dans le CRM.

## Utilisateur cible

Fondateur ou commercial d'une PME B2B, technique ou semi-technique, en France, en Belgique ou aux Pays-Bas, qui :
- refuse de payer 300 € par mois et par siège pour un outil de sales engagement,
- veut garder ses données de prospection chez lui,
- accepte de brancher ses propres comptes providers.

Ce n'est pas un produit pour une équipe de quarante commerciaux sédentaires. C'est un produit pour une équipe de un à dix qui veut une machine sérieuse sans DSI.

## Périmètre v1

**Inclus**
- 3 connecteurs de signaux : offres d'emploi, nominations, salons professionnels
- Import de fichiers CSV et XLSX avec mapping de colonnes et fusion de doublons
- Personas configurables, avec aiguillage vers les séquences
- Enrichissement entreprise et contacts
- Scoring configurable (règles + modèle de langage)
- Séquenceur multicanal avec branchements
- Email via Smartlead, LinkedIn via provider tiers, courrier via Manuscry
- Messages versionnés, déclinés en trois langues
- Boîte de réception unifiée, dans les deux sens, avec détection des réponses automatiques
- API publique et webhooks sortants
- Multi-utilisateurs avec rôles
- Interface en français, anglais, néerlandais
- Déploiement par `docker compose up`

**Exclu de la v1**
- Envoi entièrement autonome sans aucune validation
- Appels téléphoniques et SMS
- Reporting analytique au-delà des compteurs de campagne
- Version hébergée
- Reprise des données d'un outil existant

## Ce que Jay Reach n'est pas

- Pas un CRM. Il pousse vers un CRM, il n'en est pas un.
- Pas une base de contacts. Aucune donnée personnelle n'est livrée avec le produit.
- Pas un outil d'envoi de masse. Les quotas et la validation du courrier sont structurels.

## Critère de réussite de la v1

Un développeur qui découvre le dépôt clone, lance `docker compose up`, branche deux clés, importe un fichier ou définit une source, et voit sa première séquence prête — en moins de trente minutes, sans poser de question.

## Licence

**FSL-1.1-ALv2** — Functional Source License, bascule en Apache 2.0 deux ans après chaque publication.

À dire explicitement dans le README : la FSL n'est pas une licence open source au sens de l'OSI, c'est une licence *fair source*. La communauté le remarquera de toute façon ; le dire en premier vaut mieux que se le faire reprocher.

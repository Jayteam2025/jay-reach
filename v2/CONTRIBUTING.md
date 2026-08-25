# Contribuer à Jay Reach

## La contribution la plus utile

Un connecteur de signal, ou une campagne exportée qui fonctionne. Les deux font grandir le produit sans alourdir le cœur.

```bash
pnpm reach:scaffold signal mon-connecteur
```

Implémentez `discover()` et `normalize()`, ajoutez trois fixtures et leurs tests, enregistrez le provider. Aucune modification du cœur ne doit être nécessaire — si elle l'est, ouvrez une issue : c'est notre interface qui est mal conçue, pas votre connecteur.

Voir [`docs/03-sources.md`](docs/03-sources.md).

## Avant d'ouvrir une PR

- Une PR = un sujet. Pas de refonte opportuniste en passant.
- `pnpm test` et `pnpm lint` passent.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Si le comportement change, la documentation change dans la même PR.
- Toute chaîne visible existe dans les trois langues.

## Conventions

- Interface et documentation produit en français puis traduites. Code, tables et commits en anglais.
- TypeScript strict. Pas de `any`, pas de `@ts-ignore`.
- Zod sur toute donnée entrante : API, webhooks, réponses providers, fichiers importés.
- Aucun appel à un service externe hors de `packages/providers/`.

## Ce qui sera refusé

- Toute contribution qui contourne un garde-fou d'envoi, un quota, la liste de suppression ou le blocage des variables non résolues
- Un connecteur qui collecte des données sensibles
- Un connecteur qui scrape une source dont les conditions d'utilisation l'interdisent explicitement
- Une modification qui stocke des messages de boîte de réception sans correspondance avec un contact connu
- Des fixtures contenant de vraies personnes ou entreprises identifiables
- Un secret, une clé ou un jeu de données réel dans un commit

Ces refus ne sont pas négociables. Jay Reach est un outil de prospection : la seule chose qui le distingue d'un outil de spam, ce sont ses garde-fous.

## Sécurité

Ne pas ouvrir d'issue publique. Voir [`SECURITY.md`](SECURITY.md).

## Décisions d'architecture

Elles se prennent dans les issues avant d'être codées. En cas d'hésitation, ouvrez une issue avant d'écrire trois mille lignes.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous FSL-1.1-ALv2, la licence du projet.

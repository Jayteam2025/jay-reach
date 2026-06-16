# Contribuer à Jay Reach

Merci de votre intérêt pour Jay Reach ! Ce document explique comment contribuer au projet et les règles que nous suivons.

## À propos de Jay Reach

Jay Reach est un moteur de prospection conçu pour fonctionner en self-hosted. Ce dépôt est actuellement privé sur invitation. Nous accueillons les contributions des personnes invitées pour améliorer le produit, corriger des bugs et enrichir la documentation.

## Processus de contribution

Toute modification du code doit passer par une **Pull Request** :

1. **Jamais de push direct sur `main`** — créez une branche de feature ou bugfix
2. **Ouvrez une PR** en décrivant le changement
3. **Un admin du projet** (notamment @Jeeiib) reviendra vos changements
4. Une fois approuvée, votre PR est fusionnée sur `main`

Cette approche garantit la qualité et la traçabilité de tous les changements.

## Candidature pour contribuer

Si vous n'êtes pas encore invité au dépôt, vous pouvez candidater via notre **formulaire de contribution** :

[https://docs.google.com/forms/d/e/1FAIpQLSdkcrqy0ARxDwF9_bPQndiV1UkiK4fWwqlVcURV4vkQpz40kw/viewform](https://docs.google.com/forms/d/e/1FAIpQLSdkcrqy0ARxDwF9_bPQndiV1UkiK4fWwqlVcURV4vkQpz40kw/viewform)

Nous évaluons chaque candidature et nous contactons les contributeurs potentiels pour discuter de votre intérêt.

## Accords de licence

En contribuant à Jay Reach, vous acceptez que votre contribution soit utilisée sous la **Functional Source License (FSL-1.1-MIT)** décrite dans le fichier [CLA.md](CLA.md). Ce document doit être signé électroniquement avant la fusion de votre première PR.

Le CLA nous permet de relicencier le projet à l'avenir si nécessaire, tout en vous garantissant que votre contribution sera créditée et protégée.

## Configuration de l'environnement de développement

### Prérequis

- Node.js >= 22.12
- pnpm >= 9

### Installation

```bash
git clone <repo-url>
cd jay-reach
pnpm install
```

### Vérification de la santé du projet

```bash
pnpm doctor
```

### Variables d'environnement

Créez un fichier `.env` à la racine (jamais committé) :

```bash
cp .env.example .env
```

Ne commitez **jamais** de secrets ou de clés API. Les secrets d'Edge Functions Supabase sont gérés séparément en production.

## Avant de pousser : checks locaux obligatoires

Tous ces tests doivent passer sur votre machine avant de pousser :

```bash
# Linting
pnpm lint

# Type-checking (le compilateur TypeScript complet)
pnpm typecheck

# Build
pnpm build

# Tests
pnpm test:run
```

Si un check échoue, corrigez le problème localement. Les PRs avec checks échoués ne seront pas fusionnées.

### Gate anti-hardcodes

Un gate CI bloque aussi les hardcodes spécifiques à Jay (adresses email, UUIDs internes, domaines propriétaires). Lancer :

```bash
node scripts/check-no-jay-hardcodes.mjs --strict
```

Doit afficher **0 violations** avant un commit.

## Conventions de commit

- **En français** (ou anglais si vous êtes plus à l'aise)
- **Pas d'emoji** dans le message
- **Pas de mention d'outils IA** (ex: "Claude", "ChatGPT") dans le message
- Soyez descriptif sur le **pourquoi**, pas juste le **quoi**

Exemples :

```
# BON
fix: correction d'un bug de classement en prospecton
docs: ajouter le guide de configuration Supabase

# MAUVAIS
update code
fix: 123456
feat: fait avec Claude
```

## Tests et couverture

### Front-end

Les tests React utilisent Vitest + Testing Library :

```bash
pnpm test:run
```

### Back-end

Les Edge Functions Deno utilisent `deno test` :

```bash
cd supabase/functions/_shared
deno test
```

Quand vous ajoutez une feature ou corriger un bug, **ajoutez des tests** correspondants. Une PR sans tests est moins probable d'être approuvée.

## Sécurité

- **Jamais de secret commité** (clés API, tokens, mots de passe)
- **RLS (Row-Level Security)** sur toute nouvelle table Supabase
- **Validation Zod** sur tous les inputs utilisateur
- **HTTPS obligatoire** pour les redirections externes
- Signalez les vulnérabilités en privé (voir [SECURITY.md](SECURITY.md))

## Questions et support

- **Bugs ou idées de features** : ouvrez une Issue
- **Questions de design ou architecture** : discutez dans une PR ou une Discussion
- **Problèmes de sécurité** : [SECURITY.md](SECURITY.md)

## Licences et attributions

Tout le code du dépôt est sous Functional Source License (FSL-1.1-MIT). Consultez [LICENSE-FSL.md](LICENSE-FSL.md) pour les détails complets et la définition de "Competing Use".

Merci de contribuer !

---

**Besoin d'aide ?** Posez une question dans une Issue ou une PR, et un mainteneur vous répondra.

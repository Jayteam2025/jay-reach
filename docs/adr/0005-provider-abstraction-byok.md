# ADR 0005 : Abstraction providers + BYOK + mode demo

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

L'outil actuel est hard-couple a 9 APIs externes payantes :

- FullEnrich (enrichissement)
- Bouncer (validation email)
- Smartlead (campagnes emailing)
- Apify (scraping LinkedIn)
- Brave Search
- France Travail
- Adzuna
- INSEE Sirene
- Anthropic Claude + Mistral (LLM)

Pour la version OSS :
- Un dev qui clone ne va pas tout brancher pour tester
- Certains utilisent Instantly au lieu de Smartlead, ZeroBounce au lieu de Bouncer
- On veut pouvoir tester sans depenser

Pour la version SaaS Jay-managed :
- Pareil mais les cles sont gerees par nous, mutualisees

Pour les deux :
- Si demain Smartlead disparait, on switch sans tout casser

## Decision

**Abstraction par interface** + **BYOK** (Bring Your Own Key) + **mode demo natif**.

### Architecture

```
packages/providers/
├── interfaces/                  # Contrats abstrait
│   ├── email-validator.ts
│   ├── email-sender.ts
│   ├── enrichment-provider.ts
│   ├── linkedin-provider.ts
│   ├── scraping-provider.ts
│   ├── search-provider.ts
│   ├── company-registry-provider.ts
│   └── llm-provider.ts
│
├── bouncer/                     # impl EmailValidator
├── reoon/                       # impl EmailValidator (freemium)
├── zerobounce/                  # impl EmailValidator (contribue communaute)
├── smartlead/                   # impl EmailSender
├── instantly/                   # impl EmailSender (futur)
├── lemlist/                     # impl EmailSender (futur)
├── fullenrich/                  # impl EnrichmentProvider
├── hunter/                      # impl EnrichmentProvider (futur)
├── apify-linkedin/              # impl LinkedInProvider
├── brave-linkedin-fallback/     # impl LinkedInProvider (fallback)
├── brave-search/                # impl SearchProvider
├── google-search/               # impl SearchProvider (futur)
├── france-travail/              # impl ScrapingProvider
├── adzuna/                      # impl ScrapingProvider
├── insee-sirene/                # impl CompanyRegistryProvider
├── anthropic/                   # impl LLMProvider
├── mistral/                     # impl LLMProvider
├── openai/                      # impl LLMProvider (futur)
├── mocks/                       # Stubs pour mode demo
│   ├── mock-email-validator.ts
│   ├── mock-email-sender.ts
│   ├── mock-enrichment.ts
│   ├── mock-linkedin.ts
│   ├── mock-scraping.ts
│   └── mock-llm.ts
└── registry.ts                  # Provider registry + resolver
```

### Contrat de base

Chaque interface declare :

```ts
interface ProviderBase {
  readonly name: string                    // unique slug "bouncer", "reoon", ...
  readonly displayName: string             // "Bouncer.io"
  readonly category: ProviderCategory      // "email_validator"
  readonly homepage: string
  readonly pricing: PricingInfo            // "$0.001/email", "free 100/day", ...
  readonly setupGuide: string              // markdown ou URL
  validate(): Promise<ValidationResult>    // verifie que la config est OK
}

type ValidationResult =
  | { valid: true; quota?: { used: number; limit: number } }
  | { valid: false; reason: string }
```

### Registry et resolution

```ts
// packages/providers/registry.ts
export const providerRegistry = {
  email_validator: {
    bouncer: () => import('./bouncer'),
    reoon: () => import('./reoon'),
    mock: () => import('./mocks/mock-email-validator'),
  },
  email_sender: {
    smartlead: () => import('./smartlead'),
    mock: () => import('./mocks/mock-email-sender'),
  },
  // ...
}

// Resolution runtime depuis workspace_providers DB table
export async function resolveProvider<T extends ProviderCategory>(
  category: T,
  workspaceId: string,
  type: 'default' | 'fallback' = 'default'
): Promise<ProviderImplementation<T>> {
  const config = await db.workspace_providers
    .find({ workspace_id: workspaceId, provider_type: category, is_default: type === 'default' })
  
  if (!config) {
    return loadMock(category)  // fallback to mock
  }
  
  const loader = providerRegistry[category][config.provider_name]
  if (!loader) {
    throw new ProviderNotFoundError(config.provider_name)
  }
  
  const ProviderClass = (await loader()).default
  return new ProviderClass(decryptCredentials(config.credentials))
}
```

### Configuration UI

Page `/settings/providers` :
- Sections par categorie (Email validation, Email sending, Enrichment, LinkedIn, Scraping, LLM)
- Pour chaque categorie : liste des providers disponibles, statut (enabled/disabled), bouton "Configure"
- Form provider : champs credentials + bouton "Test connection" (appelle `validate()`)
- Default + Fallback selector (drag-drop ou radio)

### Mode demo

Si aucun provider n'est configure pour une categorie :
- Le resolver retourne automatiquement le mock
- Bandeau dans l'UI : "Mode demo actif - branchez votre cle Bouncer pour la validation reelle"
- Les actions destructives (envoi reel) sont bloquees en mode demo
- Seeds `examples/saas-b2b-demo/` injectent des donnees fake pour avoir quelque chose a regarder

### Encryption credentials

```sql
CREATE TABLE workspace_providers (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  provider_type TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  credentials BYTEA NOT NULL,  -- pgsodium encrypted JSONB
  config JSONB DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, provider_type, provider_name)
);
```

Pour SaaS : on chiffre avec Supabase Vault ou pgsodium.
Pour OSS self-host : optionnel (env var ou plain JSONB selon paranoia du dev).

## Consequences

### Positives

- **Switch provider sans toucher au code metier** (le scoring, le gate, le routing ne savent pas qui valide les emails)
- **Mode demo natif** = onboarding 30 secondes
- **Contributions communautaires** = chaque nouveau provider est une PR additive
- **Pas de vendor lock-in** : si Smartlead double ses prix, on switch
- **Tests faciles** : on injecte des mocks dans les tests core, pas besoin de network
- **Pricing transparent** : chaque provider declare son cout dans la registry

### Negatives

- **Cout abstraction initial** : ecrire les interfaces + refactor le code actuel pour utiliser le resolver = ~2 semaines
- **Risque "lowest common denominator"** : les interfaces doivent couvrir les capacities de tous, sans perdre les specificites (Smartlead = campaigns, Mailgun = transactional ; tres different)
- **Documentation par provider** : il faut documenter chaque provider (setup, quotas, particularites)
- **Mock fidelity** : un mock peut mentir, les tests qui passent en mock peuvent fail en reel
- **Maintenance des providers communautaires** : si un dev contribue un provider et disparait, on doit le maintenir

### Mitigations

- **Capabilities declaratives** dans chaque interface : `capabilities.batch = true/false` permet au consumer d'adapter
- **Tests d'integration optionnels** : `pnpm test:integration --provider=bouncer` qui tape la vraie API (skip si pas de cle)
- **Provider audit** : tous les 6 mois on verifie que chaque provider est encore fonctionnel
- **CODEOWNERS** : un mainteneur designe par provider, qui s'engage a maintenir

## Alternatives considerees

### Alt 1 : Hard-coupling actuel + env vars switch

Rejete. Trop limitant, code spaghetti.

### Alt 2 : Plugin system via npm packages externes

Rejete pour V1. Plus complexe, plus risque (security review des plugins). A reconsiderer en V2.

### Alt 3 : Webhook-based providers (utilisateur ecrit ses propres lambdas)

Rejete. Trop technique, casse l'experience SaaS.

### Alt 4 : One provider per category, no choice

Rejete. Defeats the purpose.

## Roadmap d'implementation

1. Phase 1.4 : implementer les interfaces + adapter les 3 providers critiques (Bouncer, Smartlead, FullEnrich) + mocks
2. Phase 1.4 : refactor le code metier pour passer par le resolver
3. Phase 2 : ajouter Reoon, Apify, France Travail, Adzuna, Brave Search comme implementations propres
4. Phase 3 (post-launch) : accepter contributions communautaires (ZeroBounce, Instantly, etc.)

## References

- Strategy pattern : Gamma et al, Design Patterns
- LangChain provider abstraction : https://js.langchain.com/docs/integrations/llms/
- Twilio provider abstraction (programmable messaging) : pattern similaire

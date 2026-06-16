# Providers — Intégrer des Fournisseurs

Jay Reach utilise un modèle **BDD-first** pour les clés API : elles sont **saisies dans l'interface**, stockées **chiffrées en base de données**, et **jamais en `.env`**.

---

## Vue d'ensemble

### Types de Providers

| Type | Rôle | Exemples |
|------|------|----------|
| **LLM** | Évalue les signaux, génère messages | Anthropic Claude, OpenAI-compatible (Mistral, etc.) |
| **Enrichement** | Complète profils (emails, LinkedIn, données) | FullEnrich, Brave Search, Apify LinkedIn, INSEE SIRENE |
| **Validation Email** | Vérifie délivrabilité | Bouncer, Reoon |
| **Outreach** | Envoie campagnes | Smartlead, SMTP (Resend) |

### Modèle de Stockage

**Schéma :**
- Table `workspace_provider_credentials` — stocke clés chiffrées par workspace
- Colonne `encrypted_key` — AES-GCM chiffrée avec secret Supabase `TOKEN_ENCRYPTION_KEY`
- Module `_shared/token-encryption.ts` — chiffre/déchiffre au runtime

**Saisie UI :**
- Onglet **Config** de l'app
- Formulaires par provider
- Validation locale + serveur

---

## LLM (Language Models)

### Anthropic Claude (Par défaut)

**Modèles supportés :**
- `claude-3-5-sonnet-20241022` (par défaut) — balance coût/qualité
- `claude-3-5-haiku-20241022` — rapide, petit
- `claude-3-opus-20250219` — puissant mais coûteux

**Activation :**

1. Obtenez votre clé API : https://console.anthropic.com/account/api-keys
2. Onglet Config → **LLM** → **Anthropic Claude**
3. Collez votre clé
4. Configurez le modèle préféré dans settings workspace

**Usage :**

```typescript
// Dans une edge function
import { resolveProvider } from './_shared/providers/registry.ts';

const llm = await resolveProvider(workspace_id, 'llm');
const response = await llm.generateScore({
  prospect: { first_name: 'Jean', last_name: 'Dupont', ... },
  signal: { type: 'job_posting', ... },
});
```

### OpenAI-Compatible (Mistral, etc.)

**Paramètres :**
- URL endpoint (ex: `https://api.mistral.ai/v1`)
- Clé API
- Modèle (ex: `mistral-medium-3.5`)

**Activation :**

1. Configurez l'endpoint (pour Mistral) : https://console.mistral.ai/api-keys/
2. Onglet Config → **LLM** → **OpenAI Compatible**
3. URL + Clé API
4. Sélectionnez le modèle

**Registry :**

```typescript
// supabase/functions/_shared/providers/registry.ts
if (provider_id === 'anthropic') {
  return new AnthropicProvider(api_key, model);
} else if (provider_id === 'openai_compatible') {
  return new OpenAICompatibleProvider(endpoint_url, api_key, model);
}
```

---

## Enrichissement

### FullEnrich

Enrichit prospects avec emails déductibles, LinkedIn URLs, données d'entreprise.

**Obtenez votre clé :** https://app.fullenrich.com/settings/api

**Activation :**

1. Clé API FullEnrich
2. Onglet Config → **Enrichissement** → **FullEnrich**
3. Collez votre clé

**Coûts :** $0.01 par email, $0.02 par personne

**Usage :**

```typescript
import { fullenrich } from './_shared/fullenrich.ts';

const result = await fullenrich.enrich({
  company_domain: 'acme.fr',
  first_name: 'Jean',
  last_name: 'Dupont',
}, api_key);

// result: { email: 'jean.dupont@acme.fr', linkedin_url: '...', ... }
```

**Webhook :** `fullenrich-webhook` — traite résultats, peuple `prospect_profiles`

### Brave Search + Apify LinkedIn

**Brave Search** = moteur de recherche privé → résultats LinkedIn.

**Apify LinkedIn Profile** = scraper RPA → snapshot profil LinkedIn (expériences, éducation).

**Activation :**

- Brave API : https://api.search.brave.com/ (gratuit jusqu'à 2k requêtes/mois)
- Apify : https://console.apify.com (gratuit, besoin crédit pour actors)

**Usage :**

```typescript
import { braveLinkdediSearch } from './_shared/brave-linkedin-search.ts';
import { apifyLinkedInProfile } from './_shared/apify-linkedin-profile.ts';

// Trouve LinkedIn URL via Brave
const linkedinUrl = await braveLinkdediSearch(name, company);

// Scrape profil
const profile = await apifyLinkedInProfile(linkedinUrl, apify_token);
```

### INSEE SIRENE

Données légales françaises (SIREN/SIRET, secteur NAF, taille, lieu).

**API** : Gratuit, gouvernement français (https://api.insee.com/)

**Activation :** Automatique (pas de clé requise)

**Usage :**

```typescript
import { sirenejQuery } from './_shared/insee-sirene.ts';

const company = await sirenejQuery('acme.fr'); // ou SIREN
// company: { siren: '123456789', name: 'Acme Inc', sector: '5829C', employees: 150, ... }
```

---

## Validation Email

### Bouncer

Vérifie la délivrabilité d'emails avec apprentissage bounce_rate.

**Obtenez votre clé :** https://usebouncer.com/dashboard

**Activation :**

1. Clé API Bouncer
2. Onglet Config → **Validation Email** → **Bouncer**
3. Collez la clé

**Statuts :** `valid | invalid | risky | disposable | unknown`

**Coûts :** $0.005 par email

**Usage :**

```typescript
import { bouncer } from './_shared/bouncer.ts';

const result = await bouncer.verify('jean@acme.fr', api_key);
// result: { status: 'valid', is_deliverable: true, risk: 0.02, ... }
```

**Gate de délivrabilité :**

```typescript
// Dans email-gate.ts
if (bouncer_status === 'valid') {
  // Push vers Smartlead
} else if (bouncer_status === 'risky' && pattern_confidence >= 0.9) {
  // Push optionnel (user décide)
} else {
  // Skip
}
```

**Batch CRON :** `bouncer-batch` (07h, 13h UTC) — vérifie les nouveaux emails

**Apprentissage :** `bounce-learning` (04h UTC) — met à jour `domain_email_patterns.bounce_rate`

### Reoon

Arbitre des cas Bouncer `unknown` ou `risky` (deuxième avis).

**Obtenez votre clé :** https://reoon.com/

**Activation :**

1. Clé API Reoon
2. Onglet Config → **Validation Email** → **Reoon** (optionnel)

**Usage :**

```typescript
import { reoon } from './_shared/reoon.ts';

const result = await reoon.verify('jean@acme.fr', api_key);
// result: { status: 'safe|risky|invalid' }
```

---

## Outreach (Campagnes)

### Smartlead

Plateforme cold email avec warm-up, suivi de réponses, webhooks.

**Obtenez votre clé :** https://smartlead.ai/settings/api

**Activation :**

1. Clé API Smartlead
2. Workspace ID Smartlead (optionnel pour multi-workspace)
3. Onglet Config → **Outreach** → **Smartlead**
4. Collez votre clé

**Usage :**

```typescript
import { smartlead } from './_shared/smartlead.ts';

// Crée ou met à jour campagne
const campaign = await smartlead.createOrUpdateCampaign({
  campaign_id: 'campaign-123',
  campaign_name: 'RH 2026-06',
  prospects: [
    { email: 'jean@acme.fr', first_name: 'Jean', last_name: 'Dupont', ... }
  ]
}, api_key);
```

**Webhook :** `send-via-smartlead` — traite réponses, met à jour `prospect_actions`

**Statuts webhook :** `sent | bounced | opened | replied | unsubscribed`

### SMTP Direct (Resend, SendGrid, etc.)

Alternative à Smartlead pour envois transactionnels.

**Activation :**

- Resend : https://resend.com/dashboard (gratuit jusqu'à 100 emails/jour)
- SendGrid : https://app.sendgrid.com/

**Module Resend intégré :** `_shared/resend.ts`

```typescript
import { resend } from './_shared/resend.ts';

await resend.send({
  from: 'contact@yourapp.fr',
  to: 'prospect@acme.fr',
  subject: 'Opportunité commerciale',
  html: '<p>Bonjour Jean...</p>'
});
```

---

## Ajouter un Nouveau Provider

### Exemple : Nouveau Enrichisseur "CompanyDB"

#### 1. Créer le fichier provider

**Fichier :** `supabase/functions/_shared/providers/companydb.ts`

```typescript
import type { EnricherProvider } from './types.ts';

export interface CompanyDBConfig {
  api_key: string;
  api_url: string;
}

export const companydbProvider: EnricherProvider = {
  name: 'companydb',
  
  async enrich(contact, company, config: CompanyDBConfig) {
    const response = await fetch(
      `${config.api_url}/search?domain=${company.domain}`,
      {
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
        },
      }
    );
    
    const data = await response.json();
    
    return {
      company_size: data.employees,
      founded_year: data.founded,
      sector: data.industry,
      ...
    };
  },
};
```

#### 2. Enregistrer dans le catalog

**Fichier :** `supabase/functions/_shared/providers/catalog.ts`

```typescript
export const PROVIDER_CATALOG = {
  // ... autres providers
  companydb: {
    name: 'CompanyDB',
    type: 'enricher',
    tier: 'growth', // ou 'business'
    cost_per_request: 0.005,
  },
};
```

#### 3. Mettre à jour le registry

**Fichier :** `supabase/functions/_shared/providers/registry.ts`

```typescript
import { companydbProvider } from './companydb.ts';

export async function resolveProvider(
  workspace_id: string,
  type: 'llm' | 'enricher' | 'validator',
  provider_id?: string
): Promise<any> {
  // ...
  if (provider_id === 'companydb' || (type === 'enricher' && !provider_id && fallback === 'companydb')) {
    const config = await getWorkspaceProviderConfig(workspace_id, 'companydb');
    return companydbProvider.enrich(contact, company, config);
  }
  // ...
}
```

#### 4. Ajouter gestion des secrets

**Stockage :** Table `workspace_provider_credentials` (chiffré)

```typescript
// Lors de l'activation dans l'UI
import { encryptToken } from './_shared/token-encryption.ts';

const encrypted = encryptToken(api_key, encryption_key);
await db.insert('workspace_provider_credentials', {
  workspace_id,
  provider_id: 'companydb',
  encrypted_key: encrypted,
});
```

**Récupération dans une edge function :**

```typescript
import { decryptToken } from './_shared/token-encryption.ts';

const encrypted = await db.selectOne('workspace_provider_credentials', {
  workspace_id, provider_id: 'companydb'
});
const api_key = decryptToken(encrypted.encrypted_key, encryption_key);
```

#### 5. Tester

```bash
deno test supabase/functions/_shared/providers/companydb.test.ts
```

---

## Configuration de Workspace

Clés et préférences LLM stockées en `workspace_config` :

```json
{
  "llm_model": "claude-3-5-sonnet-20241022",
  "llm_temperature": 0.7,
  "scoring_threshold": 0.7,
  "email_deduction_confidence": 0.85,
  "bounce_rate_threshold": 0.15,
  "archive_retention_days": 60
}
```

---

## Troubleshooting

### "API key invalid"

- Vérifiez que la clé n'a pas expiré
- Testez la clé directement (ex: `curl -H "Authorization: Bearer KEY" https://api.fullenrich.com/status`)
- Vérifiez les permissions de la clé API (certains services restreignent par IP)

### "Provider not found"

- Assurez-vous que le provider_id est enregistré dans `registry.ts`
- Vérifiez que la clé est stockée dans `workspace_provider_credentials`

### "Quota exceeded"

- Consultez les credits du provider
- Optionnel : mettre en place une alerte (ex: `fullenrich-credits-monitor` CRON)

---

## Ressources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Pipeline, edge functions
- [_shared/README.md](../supabase/functions/_shared/README.md) — Modules Deno
- [data-model.md](data-model.md) — Stockage chiffré `workspace_provider_credentials`
- API Docs:
  - Anthropic: https://docs.anthropic.com
  - FullEnrich: https://docs.fullenrich.com
  - Bouncer: https://usebouncer.com/docs
  - Smartlead: https://docs.smartlead.ai

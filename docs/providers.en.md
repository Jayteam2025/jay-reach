> [Français](providers.md) | **English**

# Providers — Integrating Vendors

Jay Reach uses a **database-first** model for API keys: they are **entered in the interface**, stored **encrypted in the database**, and **never in `.env`**.

---

## Overview

### Types of Providers

| Type | Role | Examples |
|------|------|----------|
| **LLM** | Evaluates signals, generates messages | Anthropic Claude, OpenAI-compatible (Mistral, etc.) |
| **Enrichment** | Completes profiles (emails, LinkedIn, data) | FullEnrich, Brave Search, Apify LinkedIn, INSEE SIRENE |
| **Email Validation** | Verifies deliverability | Bouncer, Reoon |
| **Outreach** | Sends campaigns | Smartlead, SMTP (Resend) |

### Storage Model

**Schema:**
- Table `workspace_provider_credentials` — stores encrypted keys per workspace
- Column `encrypted_key` — AES-GCM encrypted with Supabase secret `TOKEN_ENCRYPTION_KEY`
- Module `_shared/token-encryption.ts` — encrypts/decrypts at runtime

**UI Entry:**
- **Config** tab of the app
- Forms per provider
- Local + server validation

---

## LLM (Language Models)

### Anthropic Claude (Default)

**Supported models:**
- `claude-3-5-sonnet-20241022` (default) — balance cost/quality
- `claude-3-5-haiku-20241022` — fast, small
- `claude-3-opus-20250219` — powerful but expensive

**Activation:**

1. Get your API key: https://console.anthropic.com/account/api-keys
2. Config tab → **LLM** → **Anthropic Claude**
3. Paste your key
4. Configure preferred model in workspace settings

**Usage:**

```typescript
// In an edge function
import { resolveProvider } from './_shared/providers/registry.ts';

const llm = await resolveProvider(workspace_id, 'llm');
const response = await llm.generateScore({
  prospect: { first_name: 'Jean', last_name: 'Dupont', ... },
  signal: { type: 'job_posting', ... },
});
```

### OpenAI-Compatible (Mistral, etc.)

**Parameters:**
- Endpoint URL (e.g., `https://api.mistral.ai/v1`)
- API key
- Model (e.g., `mistral-medium-3.5`)

**Activation:**

1. Configure endpoint (for Mistral): https://console.mistral.ai/api-keys/
2. Config tab → **LLM** → **OpenAI Compatible**
3. URL + API Key
4. Select model

**Registry:**

```typescript
// supabase/functions/_shared/providers/registry.ts
if (provider_id === 'anthropic') {
  return new AnthropicProvider(api_key, model);
} else if (provider_id === 'openai_compatible') {
  return new OpenAICompatibleProvider(endpoint_url, api_key, model);
}
```

---

## Enrichment

### FullEnrich

Enriches prospects with deducible emails, LinkedIn URLs, company data.

**Get your key:** https://app.fullenrich.com/settings/api

**Activation:**

1. FullEnrich API key
2. Config tab → **Enrichment** → **FullEnrich**
3. Paste your key

**Costs:** $0.01 per email, $0.02 per person

**Usage:**

```typescript
import { fullenrich } from './_shared/fullenrich.ts';

const result = await fullenrich.enrich({
  company_domain: 'acme.fr',
  first_name: 'Jean',
  last_name: 'Dupont',
}, api_key);

// result: { email: 'jean.dupont@acme.fr', linkedin_url: '...', ... }
```

**Webhook:** `fullenrich-webhook` — processes results, populates `prospect_profiles`

### Brave Search + Apify LinkedIn

**Brave Search** = private search engine → LinkedIn results.

**Apify LinkedIn Profile** = RPA scraper → LinkedIn profile snapshot (experience, education).

**Activation:**

- Brave API: https://api.search.brave.com/ (free up to 2k requests/month)
- Apify: https://console.apify.com (free, requires credit for actors)

**Usage:**

```typescript
import { braveLinkdediSearch } from './_shared/brave-linkedin-search.ts';
import { apifyLinkedInProfile } from './_shared/apify-linkedin-profile.ts';

// Find LinkedIn URL via Brave
const linkedinUrl = await braveLinkdediSearch(name, company);

// Scrape profile
const profile = await apifyLinkedInProfile(linkedinUrl, apify_token);
```

### INSEE SIRENE

French legal data (SIREN/SIRET, NAF sector, size, location).

**API:** Free, French government (https://api.insee.com/)

**Activation:** Automatic (no key required)

**Usage:**

```typescript
import { sirenejQuery } from './_shared/insee-sirene.ts';

const company = await sirenejQuery('acme.fr'); // or SIREN
// company: { siren: '123456789', name: 'Acme Inc', sector: '5829C', employees: 150, ... }
```

---

## Email Validation

### Bouncer

Verifies email deliverability with bounce_rate learning.

**Get your key:** https://usebouncer.com/dashboard

**Activation:**

1. Bouncer API key
2. Config tab → **Email Validation** → **Bouncer**
3. Paste the key

**Statuses:** `valid | invalid | risky | disposable | unknown`

**Costs:** $0.005 per email

**Usage:**

```typescript
import { bouncer } from './_shared/bouncer.ts';

const result = await bouncer.verify('jean@acme.fr', api_key);
// result: { status: 'valid', is_deliverable: true, risk: 0.02, ... }
```

**Deliverability gate:**

```typescript
// In email-gate.ts
if (bouncer_status === 'valid') {
  // Push to Smartlead
} else if (bouncer_status === 'risky' && pattern_confidence >= 0.9) {
  // Optional push (user decides)
} else {
  // Skip
}
```

**Batch CRON:** `bouncer-batch` (07h, 13h UTC) — verifies new emails

**Learning:** `bounce-learning` (04h UTC) — updates `domain_email_patterns.bounce_rate`

### Reoon

Arbitrates Bouncer `unknown` or `risky` cases (second opinion).

**Get your key:** https://reoon.com/

**Activation:**

1. Reoon API key
2. Config tab → **Email Validation** → **Reoon** (optional)

**Usage:**

```typescript
import { reoon } from './_shared/reoon.ts';

const result = await reoon.verify('jean@acme.fr', api_key);
// result: { status: 'safe|risky|invalid' }
```

---

## Outreach (Campaigns)

### Smartlead

Cold email platform with warm-up, response tracking, webhooks.

**Get your key:** https://smartlead.ai/settings/api

**Activation:**

1. Smartlead API key
2. Smartlead Workspace ID (optional for multi-workspace)
3. Config tab → **Outreach** → **Smartlead**
4. Paste your key

**Usage:**

```typescript
import { smartlead } from './_shared/smartlead.ts';

// Create or update campaign
const campaign = await smartlead.createOrUpdateCampaign({
  campaign_id: 'campaign-123',
  campaign_name: 'HR 2026-06',
  prospects: [
    { email: 'jean@acme.fr', first_name: 'Jean', last_name: 'Dupont', ... }
  ]
}, api_key);
```

**Webhook:** `send-via-smartlead` — processes responses, updates `prospect_actions`

**Webhook statuses:** `sent | bounced | opened | replied | unsubscribed`

### SMTP Direct (Resend, SendGrid, etc.)

Alternative to Smartlead for transactional emails.

**Activation:**

- Resend: https://resend.com/dashboard (free up to 100 emails/day)
- SendGrid: https://app.sendgrid.com/

**Integrated Resend module:** `_shared/resend.ts`

```typescript
import { resend } from './_shared/resend.ts';

await resend.send({
  from: 'contact@yourapp.fr',
  to: 'prospect@acme.fr',
  subject: 'Business Opportunity',
  html: '<p>Hello Jean...</p>'
});
```

---

## Adding a New Provider

### Example: New Enricher "CompanyDB"

#### 1. Create the provider file

**File:** `supabase/functions/_shared/providers/companydb.ts`

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

#### 2. Register in the catalog

**File:** `supabase/functions/_shared/providers/catalog.ts`

```typescript
export const PROVIDER_CATALOG = {
  // ... other providers
  companydb: {
    name: 'CompanyDB',
    type: 'enricher',
    tier: 'growth', // or 'business'
    cost_per_request: 0.005,
  },
};
```

#### 3. Update the registry

**File:** `supabase/functions/_shared/providers/registry.ts`

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

#### 4. Add secret management

**Storage:** Table `workspace_provider_credentials` (encrypted)

```typescript
// When activating in UI
import { encryptToken } from './_shared/token-encryption.ts';

const encrypted = encryptToken(api_key, encryption_key);
await db.insert('workspace_provider_credentials', {
  workspace_id,
  provider_id: 'companydb',
  encrypted_key: encrypted,
});
```

**Retrieval in an edge function:**

```typescript
import { decryptToken } from './_shared/token-encryption.ts';

const encrypted = await db.selectOne('workspace_provider_credentials', {
  workspace_id, provider_id: 'companydb'
});
const api_key = decryptToken(encrypted.encrypted_key, encryption_key);
```

#### 5. Test

```bash
deno test supabase/functions/_shared/providers/companydb.test.ts
```

---

## Workspace Configuration

LLM keys and preferences stored in `workspace_config`:

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

- Verify the key has not expired
- Test the key directly (e.g., `curl -H "Authorization: Bearer KEY" https://api.fullenrich.com/status`)
- Check API key permissions (some services restrict by IP)

### "Provider not found"

- Ensure provider_id is registered in `registry.ts`
- Verify the key is stored in `workspace_provider_credentials`

### "Quota exceeded"

- Check provider credits
- Optional: set up an alert (e.g., `fullenrich-credits-monitor` CRON)

---

## Resources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Pipeline, edge functions
- [_shared/README.md](../supabase/functions/_shared/README.md) — Deno modules
- [data-model.md](data-model.md) — Encrypted storage `workspace_provider_credentials`
- API Docs:
  - Anthropic: https://docs.anthropic.com
  - FullEnrich: https://docs.fullenrich.com
  - Bouncer: https://usebouncer.com/docs
  - Smartlead: https://docs.smartlead.ai

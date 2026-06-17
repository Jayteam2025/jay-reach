> [Français](providers.md) | **English**

# Providers — Integrating External Vendors

Jay Reach is built on a **database-first, BYOK** (Bring Your Own Keys) model for API keys: they are **entered in the interface**, stored **encrypted in the database**, and **never in plain-text `.env`** files.

---

## Overview

### Provider Categories

| Category | Role | Examples |
|----------|------|----------|
| **LLM** | Evaluates signals, scores prospects | Anthropic Claude (default), OpenAI-compatible (Mistral, etc.) |
| **Source** | Fetches job offers | Adzuna, France Travail |
| **Enricher** | Enriches contacts with emails, LinkedIn, data | FullEnrich |
| **Email Validation** | Verifies email deliverability | Bouncer, Reoon (optional) |
| **Outreach** | Sends cold campaigns | Smartlead |
| **Demo** | Exploration without keys (internal stubs) | Demo (free, built-in) |

### Storage Model (Encrypted)

**Schema:**
- Table `workspace_provider_credentials` — stores encrypted keys per workspace
- Column `encrypted_secret` — encrypted with AES-GCM using Supabase secret `TOKEN_ENCRYPTION_KEY`
- Module `_shared/token-encryption.ts` — encrypts/decrypts at runtime

**UI Entry:**
- Tab **Config** → **Providers**
- One form per vendor
- Built-in connection test: `test-provider-connection` (edge function)

**Development Fallback:**
- If key not configured in database, fallback to local env variables (see `.env.example` per provider)
- In production OSS, each user brings their own keys (BYOK model)

---

## LLM (Language Models)

### Anthropic Claude (Default)

Claude scores signals to determine if a job offer matches your outreach strategy.

**Supported models:**
- `claude-3-5-sonnet-20241022` (default) — cost/quality balance, recommended
- `claude-3-5-haiku-20241022` — fast, good for lightweight tasks
- `claude-3-opus-20250219` — powerful but expensive, for complex analysis

**Get your key:**
1. Go to https://console.anthropic.com/account/api-keys
2. Click "Create Key"
3. Copy the key

**Configuration:**
1. Tab **Config** → **Providers** → **LLM**
2. Select **Anthropic (Claude)**
3. Paste your API key
4. Test the connection with **Test** button

**Costs:** Approximately $0.003 per scoring (see https://www.anthropic.com/pricing)

### OpenAI-Compatible (Mistral, OpenAI, others)

Support for OpenAI-compatible APIs (Mistral, OpenAI, etc.) with custom endpoint.

**Required parameters:**
- **Base URL**: API endpoint (e.g., `https://api.mistral.ai/v1` for Mistral)
- **API Key**: authentication token
- **Fast model**: for lightweight tasks (initial enrichment)
- **Smart model**: for scoring (complex analysis)

**Configuration:**
1. Tab **Config** → **Providers** → **LLM**
2. Select **OpenAI-compatible**
3. Fill in:
   - Base URL (e.g., `https://api.mistral.ai/v1`)
   - API Key
   - Fast model (e.g., `mistral-small`)
   - Smart model (e.g., `mistral-medium`)
4. Test the connection

**Examples:**

| Provider | Base URL | Key | Models |
|----------|----------|-----|--------|
| **Mistral** | `https://api.mistral.ai/v1` | https://console.mistral.ai/api-keys/ | `mistral-small`, `mistral-medium` |
| **OpenAI** | `https://api.openai.com/v1` | https://platform.openai.com/api-keys | `gpt-4o-mini`, `gpt-4o` |

---

## Job Sources (Scraping)

Jay Reach fetches job offers from two main sources. You **must activate at least one source** to scrape offers.

### Adzuna

Aggregator of French and international job offers (structured REST API, high quality).

**Get your credentials:**
1. Go to https://developer.adzuna.com
2. Sign up or log in
3. Create an application (dashboard → API Accounts)
4. Note **App ID** and **App Key**

**Configuration:**
1. Tab **Config** → **Providers** → **Job Sources**
2. Select **Adzuna**
3. Fill in:
   - App ID
   - App Key
4. Test the connection

**Coverage:** France, UK, Germany, Switzerland, and 25+ countries
**Costs:** Free (5000 requests/month by default, extensible)
**Updated:** Daily

### France Travail (formerly Pôle Emploi)

Official French public employment service (GraphQL API, public data).

**Get your credentials:**
1. Go to https://francetravail.io
2. Request API access (section "Partners")
3. Accept terms
4. You will receive **Client ID** and **Client Secret** by email

**Configuration:**
1. Tab **Config** → **Providers** → **Job Sources**
2. Select **France Travail**
3. Fill in:
   - Client ID
   - Client Secret
4. Test the connection

**Coverage:** France only (public service data)
**Costs:** Free
**Updated:** Daily

---

## Enricher (Contacts & Emails)

### FullEnrich

Enriches prospects with **deductible emails**, LinkedIn URLs, company data.

**What it does:**
- Find prospect's professional email (e.g., jean.dupont → jean.dupont@acme.fr)
- Retrieve LinkedIn profile
- Complete domain, sector, company size

**Get your key:**
1. Go to https://app.fullenrich.com
2. Sign up or log in
3. Tab **Settings** → **API** → copy your **API Key**

**Configuration:**
1. Tab **Config** → **Providers** → **Enricher**
2. Select **FullEnrich**
3. Paste your API key
4. Test the connection

**Costs:** $0.01 per deductible email, $0.02 per person enrichment
**Quota limit:** Available in Settings → Billing on FullEnrich

---

## Email Validation (Deliverability)

Before sending a campaign, validate that emails are **active** (typos, disposable, role addresses, etc.).

### Bouncer (Primary)

Verifies deliverability with **automatic learning** of bounce rates per domain.

**What it does:**
- Detect typos (google.com vs googel.com)
- Exclude role addresses (info@, contact@, noreply@)
- Identify disposable/temporary emails
- Predict bounces before sending (saves Smartlead credits)

**Get your key:**
1. Go to https://usebouncer.com
2. Sign up → Dashboard
3. Tab **Settings** → **API** → copy your key

**Configuration:**
1. Tab **Config** → **Providers** → **Email Validation**
2. Select **Bouncer**
3. Paste your API key
4. Test the connection

**Returned statuses:** `valid` | `invalid` | `risky` | `disposable` | `role` | `unknown`

**Costs:** $0.005 per email verified

**Automation:**
- Automatic verification during enrichment
- Daily batch cron (07h, 13h UTC) to re-verify cached emails
- Automatic learning (04h UTC): updates `domain_email_patterns.bounce_rate`

### Reoon (Optional — Arbitration)

Second opinion for Bouncer's **unknown** or **risky** cases.

**What it does:**
- Arbitrate uncertain emails
- Improve deliverability rate when Bouncer hesitates
- Decision-making in case of doubt

**Get your key:**
1. Go to https://reoon.com
2. Sign up
3. Tab **API** → copy your key

**Configuration:**
1. Tab **Config** → **Providers** → **Email Validation**
2. Select **Reoon** (optional)
3. Paste your API key
4. Test the connection

**Returned statuses:** `safe` | `risky` | `invalid`

**Recommendation:** Use Bouncer alone to start, add Reoon if you manage high volume.

---

## Outreach (Campaign Sending)

Smartlead is your only sending channel. It's a cold email platform with automatic warm-up, response tracking, and integrated webhooks.

### Smartlead

**What it does:**
- Send your cold campaigns
- Automatic IP warm-up (reputation)
- Track opens, clicks, replies
- Real-time webhook status updates
- Manage bounces/unsubscribe

**Get your key:**
1. Go to https://smartlead.ai
2. Log in or create an account
3. Tab **Settings** → **API** → copy your key

**Configuration:**
1. Tab **Config** → **Providers** → **Outreach**
2. Select **Smartlead**
3. Paste your API key
4. Test the connection

**Persona → Campaign Mapping:**

Each **persona** (HR, Director, Field Sales, etc.) must be linked to a **Smartlead campaign**. Configure this mapping in tab **Config** → **Campaigns**:

| Persona | Smartlead Campaign | Email Template |
|---------|-------------------|----------------|
| HR | `hr-2026-06` | Recruitment |
| Director | `director-2026-06` | Commercial Expansion |
| Field Sales | `sales-2026-06` | Partnership |

> Each prospect is assigned to a campaign based on their detected role. Sent emails maintain a unique subject/signature per campaign.

**Tracking statuses:** `sent | bounced | opened | replied | unsubscribed`

**Costs:** Based on number of emails sent (see https://smartlead.ai/pricing)

---

> Note on Resend
>
> **Resend** is used **only for internal notifications** (weekly recap, FullEnrich credit alerts) via the `RESEND_API_KEY` secret in Edge Functions. **It is NOT an outreach provider** and does not configure in the Providers interface. Campaign sending is exclusively via Smartlead.

---

## Demo Mode (without keys)

Explore Jay Reach without configuring keys using **Demo mode**. It generates realistic data (prospects, emails, Bouncer verdicts) and works entirely offline.

**Use cases:**
- First hands-on (30 min)
- Commercial demo
- Local testing without credits

**Activation:**
1. Tab **Config** → **Providers** → **LLM**
2. Select **Demo**
3. No key to fill in
4. Test — you can scrape, score, enrich with fake data

> Demo mode always returns consistent decisions (same prospect = same verdict), perfect for testing the entire workflow.

---

## Connection Test

Each provider has a **Test** button in its configuration card. Click it to verify:
- Valid and non-expired key
- Correct permissions
- Network API connectivity
- Quota limit not reached

If error occurs, see **Troubleshooting** section below.

---

## Troubleshooting

### "API key invalid"

**Possible causes:**
- Key expired
- Key partially copied
- Wrong key for the service (Adzuna app_id ≠ Bouncer api_key)
- Insufficient permissions (some services restrict by IP)

**Solution:**
1. Check the provider's dashboard (e.g., https://usebouncer.com/dashboard → Settings → API)
2. Generate a new key if needed
3. Paste the complete key (no partial copies)
4. Test again

### "Provider not found"

- Verify the provider is in the list (see Overview above)
- Reload page: `Ctrl+R` or `Cmd+R`
- Clear cache: `Ctrl+Shift+Delete`

### "Quota exceeded / Rate limit"

- Check provider dashboard (remaining credits)
- Upgrade your plan with the provider if needed
- For Adzuna: default limit 5000/month, request increase via developer.adzuna.com
- For FullEnrich: limit per subscription tier, check Settings → Billing

### I want to test without keys (local mode)

Activate **Demo mode** (see section above). Zero credentials required.

---

## Resources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Pipeline, edge functions
- [data-model.md](data-model.md) — Encrypted storage `workspace_provider_credentials`
- Official API documentation:
  - Anthropic: https://docs.anthropic.com
  - FullEnrich: https://docs.fullenrich.com
  - Bouncer: https://usebouncer.com/docs
  - Smartlead: https://docs.smartlead.ai
  - Adzuna: https://developer.adzuna.com/documentation
  - France Travail: https://francetravail.io/developer

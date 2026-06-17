> [Français](self-host.md) | **English**

# Complete Self-Host Guide — Jay Reach

Deploy your own Jay Reach instance from scratch: clone, configure, run locally, integrate providers, automate tasks.

---

## Prerequisites

### Required Software

| Component | Version | Installation |
|-----------|---------|--------------|
| **Node.js** | ≥ 22.12 | https://nodejs.org |
| **pnpm** | ≥ 10.0.0 | `npm install -g pnpm` or via Homebrew |
| **Supabase CLI** | latest | `brew install supabase/tap/supabase` (macOS) or `npm install -g supabase` |
| **Git** | latest | https://git-scm.com |

### Verify Your Installations

```bash
node --version          # v22.x.x or higher
pnpm --version          # 10.x.x or higher
supabase --version      # 2.x.x or higher
git --version           # 2.x.x or higher
```

### Supabase Cloud Account

1. Go to https://supabase.com
2. Create an account (free)
3. Create a **new project**
4. **Keep these details:**
   - **Project URL** : `https://YOUR-REF.supabase.co` (Settings → API → Project URL)
   - **Anon key** : public key (Settings → API → Anon key)
   - **Project Ref** : the ID in the URL (e.g., `abc123defghijklmnopq`)
   - **Database password** : set at project creation

> **Note:** Supabase Cloud is required (no local instance for self-host). To explore locally first, use `supabase start` (Docker) on a test branch.

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
```

---

## Step 2: Install Dependencies

```bash
pnpm install
```

**pnpm** uses a shared store, so subsequent installs are very fast. Do not use `npm install` or `yarn`.

---

## Step 3: Environment Configuration

### Create `.env` file

```bash
cp .env.example .env
```

### Fill in the variables

Open `.env` in a text editor and fill in the fields below. **Provider keys do NOT go here** (see §Edge Function Secrets).

```bash
# === FRONT-END (public, visible in browser) ===
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key

# === BACK-END (used only by `pnpm run setup` and `pnpm run doctor`) ===
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SUPABASE_PROJECT_REF=YOUR-PROJECT-REF
SUPABASE_DB_PASSWORD=YOUR_DATABASE_PASSWORD
```

#### Detail of each variable

**1. VITE_SUPABASE_URL**
- Source: Supabase Dashboard → Your project → Settings → API → "Project URL"
- Format: `https://abc123xyz.supabase.co`

**2. VITE_SUPABASE_ANON_KEY**
- Source: Supabase Dashboard → Settings → API → "Anon key (public)"
- This is the **public key**, **not** the service_role key

**3. SUPABASE_ACCESS_TOKEN**
- Source: https://supabase.com/dashboard/account/tokens
- Click "Generate new token"
- Copy the full token (starts with `sbp_`)
- Required permissions: "Functions: Deploy + Manage", "Database"

**4. SUPABASE_PROJECT_REF**
- The project ID (e.g., `abc123defghijklmnopq`)
- Visible in dashboard URL: `https://app.supabase.com/project/{REF}`
- Or Settings → General → Project Reference ID

**5. SUPABASE_DB_PASSWORD**
- Provided at project creation
- Or reset via Supabase Dashboard → Settings → Database → Reset Password

> **Security:** `.env` is **gitignored**. Never commit it.

---

## Step 4: Health Check

Before setup, verify everything is in place:

```bash
pnpm run doctor
```

This verifies:
- Node.js ≥ 22.12
- pnpm ≥ 10.0.0
- Supabase CLI available
- Access to your Supabase project (from `.env`)
- Internet connectivity

**Common errors and solutions:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Supabase CLI not found` | CLI not installed | `npm install -g supabase` |
| `VITE_SUPABASE_URL undefined` | `.env` incomplete | Re-read §Fill in the variables above |
| `Invalid SUPABASE_ACCESS_TOKEN` | Token expired or wrong | Regenerate at https://supabase.com/dashboard/account/tokens |
| `Database connection failed` | Wrong password or IP blocked | Verify `SUPABASE_DB_PASSWORD`, check IP is not blocked |

---

## Step 5: Initial Setup — Database & Edge Functions

```bash
pnpm run setup
```

This script **automatically** performs:

1. **Supabase project linking** — links your `.env` to the cloud project
2. **SQL migrations** — creates tables, RLS schema, stored functions
3. **Encryption secret generation** — `TOKEN_ENCRYPTION_KEY` deployed to Edge Functions (encrypts provider keys in database)
4. **30 edge functions deployment** — reactive Deno functions for the pipeline (takes 3–5 min)
5. **Workspace initialization** — creates the default multi-tenant "workspace" (a workspace = your instance)

**Duration:** 3–5 minutes (first time)

**Expected output:**
```
[OK] Migrations applied
[OK] Edge Functions deployed (30/30)
[OK] Encryption secret generated
[OK] Workspace created
[OK] Ready to go
```

**Common errors:**

| Error | Solution |
|-------|----------|
| "Migrations applied: 0/17" | Verify `SUPABASE_DB_PASSWORD`, then retry |
| "Failed to deploy function X" | Redeploy: `supabase functions deploy <fn-name> --no-verify-jwt` |

---

## Step 6: Start Dev Server

```bash
pnpm dev
```

Starts Vite on `http://localhost:8080`.

Open your browser and go to **http://localhost:8080**.

---

## Step 7: Create Your First User (Admin)

1. Click **"Sign up"** (or "S'inscrire")
2. Enter an email (e.g., `admin@example.com`) and a password
3. Confirm
4. You're logged in and redirected to the **Prospection** tab

> **Important:** The first user is automatically **admin** of the workspace. All subsequent users are in the same workspace.

---

## Step 8: Edge Function Secrets

Some optional services require secrets that do **not** go in `.env` (must not be local). They're deployed directly to Supabase via Supabase CLI.

### TOKEN_ENCRYPTION_KEY (automatic)

Generated and deployed by `pnpm run setup`. Nothing to do.

### Optional: Notifications & Webhooks

#### A. Resend (internal notifications — weekly recap + credit alerts)

If you want to receive weekly recap emails or FullEnrich credit alerts:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxx --project-ref <your-ref>
supabase secrets set RESEND_FROM=noreply@yourdomain.com --project-ref <your-ref>
supabase secrets set ALERT_RECIPIENTS=admin@example.com,ops@example.com --project-ref <your-ref>
```

(Get key: https://resend.com/api-keys)

#### B. Smartlead Webhook (optional — response tracking)

If you want Smartlead to automatically update your campaign statuses:

```bash
supabase secrets set SMARTLEAD_WEBHOOK_SECRET=your_webhook_secret --project-ref <your-ref>
```

> These secrets are **encrypted** in transit and at rest in Supabase.

---

## Step 9: Configure Providers

All API keys are entered **in the app**, **Configuration** → **Providers** tab. Never in `.env`.

### Demo Mode (no keys)

The app works **entirely in demo mode** without any keys configured. Realistic mock data is generated for exploration. Perfect for learning.

### LLM (Required — signal evaluation)

**Anthropic Claude (default):**

1. Go to https://console.anthropic.com/account/api-keys
2. Click "Create Key"
3. Copy the full key
4. In app: **Configuration** → **LLM** → **Anthropic Claude**
5. Paste your key
6. Select model (default: `claude-3-5-sonnet-20241022`) — good cost/quality balance
7. Click **Test** to verify
8. Save

**Available models:**
- `claude-3-5-sonnet-20241022` (recommended: cost/quality balance)
- `claude-3-5-haiku-20241022` (fast, budget)
- `claude-3-opus-20250219` (powerful, expensive)

**Alternative:** OpenAI-compatible (Mistral, etc.) — see [providers.md](providers.md)

**Costs:** About $0.003 per evaluated signal

### Sourcing (Adzuna + France Travail)

Built-in natively. They search public job postings **for free**.

- **Adzuna** : https://developer.adzuna.com
  - In app: **Configuration** → **Sources** → **Adzuna**
  - You'll get `app_id` and `app_key`
  - (Free to start)

- **France Travail** : https://francetravail.io
  - In app: **Configuration** → **Sources** → **France Travail**
  - You'll get `client_id` and `client_secret`
  - (Free)

### Enrichment (FullEnrich — emails & LinkedIn)

Enriches each prospect with email address, LinkedIn profile, company data.

1. Go to https://app.fullenrich.com/settings/api
2. Copy your API key
3. App: **Configuration** → **Enrichment** → **FullEnrich**
4. Paste the key
5. Test
6. Save

**Costs:** $0.01–$0.02 per prospect (free for first 100)

### Email Validation (Bouncer — deliverability)

Predicts bounces before sending, saves Smartlead credits.

1. Go to https://usebouncer.com/dashboard
2. Copy your API key
3. App: **Configuration** → **Email Validation** → **Bouncer**
4. Paste the key
5. Test
6. Save

**Costs:** $0.005 per email verified (free for first 100)

### Outreach (Smartlead — cold email sends)

Only sending channel for email campaigns.

1. Go to https://smartlead.ai/settings/api
2. Copy your API key
3. App: **Configuration** → **Outreach** → **Smartlead**
4. Paste the key
5. Test
6. Save

**Costs:** Starting at $59/month (warm-up + sends)

**Map Persona → Smartlead Campaign:**
After setup, go to **Configuration** → **Campaigns** and map each persona (HR, Director, Field Sales, etc.) to a Smartlead campaign.

---

## Step 10: Launch Your First Campaign

### 1. Create a Trigger (signal detector)

1. **Prospection** → **Triggers**
2. **+ Add trigger**
3. Fill in:
   - **Name** : `Test HR CDI`
   - **Type** : `job_posting`
   - **Filters** :
     - Title: `HR Manager|HR Lead|HR Director`
     - Contract: `CDI`
   - **Score multiplier** : `1.0`
4. Save

### 2. Create a Persona (target profile)

1. **Prospection** → **Personas**
2. **+ Add persona**
3. Fill in:
   - **Name** : `Test HR France`
   - **Titles** : `HR Director|HR Lead|Talent Manager`
   - **Sectors** : `Tech|Finance|Retail` (optional)
   - **Country** : `France`
4. Save

### 3. Launch sourcing

1. **Prospection** → **Sourcing**
2. Select your **Trigger** + **Persona**
3. **Start sourcing**
4. Wait 2–3 minutes (Adzuna + France Travail scrape)
5. Check **Prospects** tab to see results

### 4. Enrich prospects

1. **Enrichment**
2. Select your batch
3. **Enrich** (calls FullEnrich)
4. Wait for webhook (2–5 min per prospect)
5. Check **Enrichment** → your batch to see emails + LinkedIn

### 5. Validate emails

1. **Email Audit**
2. **Check deliverability** (calls Bouncer)
3. Wait for results (valid / risky / invalid)
4. Filter by "valid" to keep the best

### 6. Send via Smartlead

1. **Campaigns**
2. Select "valid" prospects
3. **Send to Smartlead**
4. Real-time tracking (replies, bounces, clicks)

---

## Step 11: Schedule Tasks (Crons) — Optional

By default, the core pipeline works **without any crons** (sourcing triggered manually, enrichment async via webhooks). But to automate recurring tasks, enable crons:

### Scheduling Script

```bash
pnpm run setup:crons
```

This configures (via **pg_cron** Supabase) automated jobs:

| Job | Frequency | Role |
|-----|-----------|------|
| **enrichment_poll** | Every 15 min | Poll pending FullEnrich webhooks |
| **bouncer_batch** | 07h + 13h UTC | Batch Bouncer emails pending |
| **bounce_learning** | 04h UTC | Update empirical bounce patterns |
| **credit_alerts** | 06h UTC | Alert if FullEnrich credits < 20% |
| **recap_weekly** | Monday 08h UTC | Weekly recap email (via Resend) |
| **cleanup_retention** | Daily 02h UTC | Delete archived prospects > 60 days |

> You can also trigger these manually via UI or API.

### Alternative: Manual Crons (supabase CLI)

If you prefer to control crons yourself:

```bash
# List existing crons
supabase functions list

# Trigger a job manually (example)
supabase functions invoke bouncer-batch --project-ref <ref> \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

> **Note:** `setup:crons` and its manual alternative are optional. The funnel **works without** — sourcing, enrichment, validation all happen on-demand via UI.

---

## Hardening & Post-Deployment Security

### Enable Password Compromise Detection

Supabase can check if a password is on **Have I Been Pwned** (HIBP):

1. Supabase Dashboard → **Authentication** → **Password compromised detection**
2. Enable

### Checklist

- [ ] `.env` is **gitignored** (verify `.gitignore`)
- [ ] No secrets hardcoded in code (`pnpm run check:hardcodes`)
- [ ] RLS enabled on **all tables** (Dashboard → SQL Editor → run default RLS creation)
- [ ] **Custom domain configured** (DNS CNAME to Vercel/Netlify/Docker)
- [ ] **Supabase backup** enabled (Dashboard → Backups)
- [ ] **Monitoring** set up (Sentry, CloudWatch, etc.)

---

## Troubleshooting

### `pnpm run setup` fails

**Symptom:** "Migrations applied: 0/17" or "Connection refused"

**Solutions:**
1. Check `.env` :
   ```bash
   grep "SUPABASE_" .env
   ```
2. Test connection manually:
   ```bash
   supabase status --project-ref <ref>
   ```
3. Verify token permissions (must have "Functions Deploy" + "Database")
4. Reset DB password via Supabase Dashboard → Settings → Reset Password

### `pnpm dev` won't start

**Symptom:** "Port 8080 already in use" or "VITE_* undefined"

**Solutions:**
1. Check `.env` complete (all `VITE_*` variables)
2. Kill the port:
   ```bash
   lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9
   ```
3. Restart `pnpm dev`

### Signup fails

**Symptom:** "Email already exists" or "JWT invalid"

**Solutions:**
1. Verify Supabase Auth is enabled (Dashboard → Authentication → Providers → Email)
2. Verify `VITE_SUPABASE_ANON_KEY` is the **public key** (not service_role)
3. To test locally: `supabase db reset --project-ref <ref>` (destructive)

### Edge Functions won't deploy

**Symptom:** "Failed to deploy function X"

**Solutions:**
1. Check Edge Function quota (Dashboard → Edge Functions → Quotas)
2. Verify token permissions
3. Redeploy individually:
   ```bash
   supabase functions deploy webhook-enrichment --no-verify-jwt --project-ref <ref>
   ```
4. Check Deno syntax:
   ```bash
   deno check supabase/functions/webhook-enrichment/index.ts
   ```

---

## Production Deployment

### Front-End Hosting

**Option 1: Vercel (recommended)**

```bash
npm install -g vercel
vercel
```

Follow prompts. Vercel automatically configures `VITE_*` variables.

**Option 2: Netlify**

```bash
npm install -g netlify-cli
netlify deploy
```

**Option 3: Docker (self-hosted)**

```bash
docker build -t jay-reach .
docker run -p 80:8080 -e VITE_SUPABASE_URL=... -e VITE_SUPABASE_ANON_KEY=... jay-reach
```

### Supabase Production

1. Create a **new Supabase project** for production (don't share with dev)
2. Update `.env` with the new project's keys
3. Run `pnpm run setup` (it will link to the new project)
4. Deploy edge functions: `supabase functions deploy --project-ref <prod-ref>`

### SSL/HTTPS

- **Vercel/Netlify** : automatic
- **Docker** : set up Nginx reverse proxy + Let's Encrypt

---

## Resources

- **[README.md](../README.md)** — Quick start
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Prospecting pipeline, edge functions
- **[data-model.md](data-model.md)** — Database schema, RLS
- **[providers.md](providers.md)** — Integration technical details
- **[Supabase Docs](https://supabase.com/docs)** :
  - [Edge Functions](https://supabase.com/docs/guides/functions)
  - [Database](https://supabase.com/docs/guides/database)
  - [Auth](https://supabase.com/docs/guides/auth)

---

## Support

- **Bug or Idea:** Open an [Issue](https://github.com/Jayteam2025/jay-reach/issues)
- **Security:** [SECURITY.md](../SECURITY.md)
- **Contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)

Happy prospecting!

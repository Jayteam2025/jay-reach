> [Français](self-host.md) | **English**

# Complete Self-Host Guide — Jay Reach

This guide walks you through deploying your own Jay Reach instance, from local configuration to production.

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

### Supabase Account

1. Go to https://supabase.com
2. Create an account (free)
3. Create a new project
4. **Note:**
   - Project URL (Settings → API → Project URL)
   - Anon key (Settings → API → anon key / public key)
   - Project Ref (the ID in the URL, e.g., `YOUR-PROJECT-REF`)
   - Database password (visible at project creation)

> **Tip:** If exploring locally first, use `supabase start` (local Docker). For production, use Supabase Cloud.

---

## Step 1: Clone the Repo

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
```

---

## Step 2: Install Dependencies

```bash
pnpm install
```

This installs all packages (React, Vite, Supabase, Deno, etc.). Pnpm uses a shared store, so subsequent installs are fast.

> **Common issue:** Avoid `npm install` (legacy) or `yarn`. Always use **pnpm**.

---

## Step 3: Environment Configuration

### Copy the `.env` template

```bash
cp .env.example .env
```

### Fill in the variables

Open `.env` with your editor and complete:

```bash
# Front-end (visible in browser, public)
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY

# Back-end (used by pnpm run setup only)
SUPABASE_ACCESS_TOKEN=YOUR_CLI_TOKEN
SUPABASE_PROJECT_REF=YOUR-PROJECT-REF
SUPABASE_DB_PASSWORD=YOUR_DB_PASSWORD
```

**Where to find each key:**

1. **VITE_SUPABASE_URL** and **VITE_SUPABASE_ANON_KEY**
   - Supabase Dashboard → Your project → Settings → API
   - Copy "Project URL" and "Anon key (public)"

2. **SUPABASE_ACCESS_TOKEN**
   - https://supabase.com/dashboard/account/tokens
   - Create a new access token
   - Copy the full token (starts with `sbp_`)

3. **SUPABASE_PROJECT_REF**
   - It's the ID in the dashboard URL (e.g., `abc123defg45hijkl`)
   - Or go to Settings → General → Project Reference ID

4. **SUPABASE_DB_PASSWORD**
   - Visible at project creation
   - Or reset it via Database Settings → Reset Database Password

> **Security:** `.env` is in `.gitignore` — never committed.

---

## Step 4: Health Check

```bash
pnpm run doctor
```

This verifies:
- ✓ Node.js ≥ 22.12
- ✓ pnpm ≥ 10.0.0
- ✓ Supabase CLI
- ✓ Access to your Supabase project
- ✓ Internet connectivity

**Common errors:**

| Error | Solution |
|-------|----------|
| `Supabase CLI not found` | `npm install -g supabase` |
| `Invalid SUPABASE_ACCESS_TOKEN` | Regenerate at https://supabase.com/dashboard/account/tokens |
| `Database connection failed` | Verify `SUPABASE_DB_PASSWORD` + IP whitelist |

---

## Step 5: Initial Setup

```bash
pnpm run setup
```

This:
1. **Applies SQL migrations** — creates tables, RLS, functions
2. **Generates encryption key** — `TOKEN_ENCRYPTION_KEY` (provider secrets)
3. **Deploys 38 edge functions** — (may take 2-3 min)
4. **Creates initial workspace** — multi-tenant tenant
5. **Prepares authentication** — auth.users + profiles

**Estimated time:** 3-5 minutes (first time)

**After success, you'll see:**
```
✓ Migrations applied (17 files)
✓ Edge Functions deployed (38/38)
✓ Encryption key generated
✓ Workspace created: "My Instance"
✓ Ready for pnpm dev
```

---

## Step 6: Run Locally

```bash
pnpm dev
```

Starts Vite dev server on `http://localhost:8080`.

In your browser, visit **http://localhost:8080**.

---

## Step 7: Sign Up

1. Click **"Sign up"**
2. Enter an email (e.g., `test@example.com`) and a password
3. You're redirected to the **Prospection** tab (empty at first)
4. Open the **Settings** tab (gear icon) to connect providers

---

## Step 8: Configure Providers

To prospect, you need API keys for third-party services. **All keys are entered in the app, Settings tab** (never in `.env`).

### LLM (Required to evaluate signals)

**Anthropic Claude (default):**

1. Go to https://console.anthropic.com/account/api-keys
2. Create an API key
3. In the app, **Settings** → **LLM** → **Anthropic Claude**
4. Paste your key
5. Select model (default: `claude-3-5-sonnet-20241022`)

### Enrichment (FullEnrich — email deduction + LinkedIn)

1. Go to https://app.fullenrich.com/settings/api
2. Copy your API key
3. App **Settings** → **Enrichment** → **FullEnrich**
4. Paste the key

**Costs:** $0.01–0.02 per prospect (free for first 100)

### Email Validation (Bouncer — deliverability)

1. Go to https://usebouncer.com/dashboard
2. Copy your API key
3. App **Settings** → **Email Validation** → **Bouncer**
4. Paste the key

**Costs:** $0.005 per email (free for first 100)

### Outreach (Smartlead — cold email campaigns)

1. Go to https://smartlead.ai/settings/api
2. Copy your API key
3. App **Settings** → **Outreach** → **Smartlead**
4. Paste the key

**Costs:** Starting at $59/month for warm-up + sends

---

## Step 9: First Campaign (Test)

### Create a Trigger (Signal Detector)

1. **Prospection** tab → **Triggers** sub-tab
2. Click **+ Add trigger**
3. Name: `Test HR CDI`
4. Type: `job_posting`
5. Filters:
   - Title: `HR Manager|HR Lead|HR Director`
   - Contract: `CDI`
6. Score multiplier: `1.0`
7. Save

### Create a Persona (Targeting Criteria)

1. **Prospection** tab → **Personas** sub-tab
2. Click **+ Add persona**
3. Name: `Test HR France`
4. Titles: `HR Director|HR Lead|Talent Manager`
5. Sectors: `Tech|Finance|Retail` (optional)
6. Geographies: `France`
7. Save

### Launch Sourcing

1. **Prospection** tab → **Sourcing** sub-tab
2. Select your trigger + persona
3. Click **Start sourcing**
4. Wait 2-3 minutes (Adzuna + France Travail scrape)
5. You'll see detected prospects

### Evaluation & Enrichment

1. **Enrichment** tab
2. Select a batch
3. Click **Enrich** (FullEnrich + LinkedIn)
4. Wait for webhook (2-5 min per prospect)

### Email Validation

1. **Email Audit** tab
2. Click **Check deliverability** (Bouncer batch)
3. See results (valid/risky/invalid)

### Push Smartlead

1. **Campaigns** tab
2. Select validated prospects
3. Click **Send to Smartlead**
4. Track responses in real-time

---

## Production Deployment

### Front-End Hosting

**Option 1: Vercel (recommended)**

```bash
npm install -g vercel
vercel
```

Follow prompts. Vercel configures CI/CD automatically.

**Option 2: Netlify**

```bash
npm install -g netlify-cli
netlify deploy
```

**Option 3: Docker (self-hosted)**

```bash
docker build -t jay-reach .
docker run -p 80:8080 -e VITE_SUPABASE_URL=... jay-reach
```

### Supabase Production

1. Use **Supabase Cloud** (https://supabase.com) — not "local"
2. Update `.env` with production project keys
3. Redeploy edge functions:

```bash
supabase functions deploy --project-ref <prod-ref>
```

### SSL/HTTPS

- **Vercel/Netlify**: HTTPS automatic
- **Docker**: Set up Nginx reverse proxy + Let's Encrypt

### Monitoring

Supabase Dashboard provides:
- Edge function logs
- Database monitoring
- Real-time activity

---

## Troubleshooting

### `pnpm run setup` fails

**Issue:** "Migrations applied: 0/17"

**Solutions:**
1. Verify `SUPABASE_ACCESS_TOKEN` (valid and permissions granted)
2. Verify `SUPABASE_PROJECT_REF` (matches project ID)
3. Reset database password (Supabase Dashboard → Settings → Reset Password)
4. Test connection:
   ```bash
   supabase status --project-ref <ref>
   ```

### `pnpm dev` won't start

**Issue:** "Port 8080 already in use" or "VITE_SUPABASE_URL undefined"

**Solutions:**
1. Verify `.env` is filled (`VITE_*` variables)
2. Kill process on port 8080:
   ```bash
   lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9
   ```
3. Restart `pnpm dev`

### Signup fails

**Issue:** "Email already exists" or JWT invalid

**Solutions:**
1. Supabase Auth must be enabled (Settings → Authentication → Enable)
2. Verify `VITE_SUPABASE_ANON_KEY` is the **public key** (not service_role)
3. Reset database: `supabase db reset --project-ref <ref>` (destructive, dev only)

### Edge Functions won't deploy

**Issue:** "Failed to deploy function X"

**Solutions:**
1. Verify `SUPABASE_ACCESS_TOKEN` has "Functions Deploy" permission
2. Check edge function quota (Supabase Dashboard)
3. Deploy individually:
   ```bash
   supabase functions deploy score-prospect-signals --project-ref <ref> --no-verify-jwt
   ```

---

## Recommended Improvements

### Post-Deployment

- [ ] Enable **2FA** (Settings → Authentication → 2FA)
- [ ] Configure **custom domain** (Vercel/Netlify settings)
- [ ] Set up **monitoring** (Sentry, Logrocket, etc.)
- [ ] Enable **automatic backups** (Supabase backups)
- [ ] **Image CDN** (Cloudinary, AWS S3, etc.)

### Optional

- Chrome extension for LinkedIn scraping (see [ARCHITECTURE.md](ARCHITECTURE.md))
- Outbound webhooks (for external CRM)
- Email notifications (via Resend, SendGrid)

---

## Resources

- **[README.md](../README.md)** — Quick start
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Pipeline, edge functions
- **[data-model.md](data-model.md)** — DB schema, RLS
- **[providers.md](providers.md)** — Integrate new providers
- **Supabase Docs**: https://supabase.com/docs
  - [Edge Functions](https://supabase.com/docs/guides/functions)
  - [Database](https://supabase.com/docs/guides/database)
  - [Auth](https://supabase.com/docs/guides/auth)
- **Vite Docs**: https://vitejs.dev
- **React Docs**: https://react.dev

---

## Support

- **Bug or Question:** Open an [Issue](https://github.com/Jayteam2025/jay-reach/issues)
- **Security:** [SECURITY.md](../SECURITY.md)
- **Contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)

Happy prospecting! 🚀

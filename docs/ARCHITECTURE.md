# Architecture de Jay Reach

## Vue d'ensemble

Jay Reach est une plateforme multi-tenant de prospection conçue autour de trois piliers :

1. **Sourceur** — Scrape les annonces d'emploi (Adzuna, France Travail)
2. **Moteur de scoring** — Note les prospects selon des signaux commerciaux (LLM + règles)
3. **Outreach** — Enrichit les profils, vérifie les emails, envoie des campagnes cold email

Toute la logique est **agnostique à l'utilisateur** : chaque opérateur configure ses propres triggers, personas, templates et fournisseurs (LLM, enrichissement, outreach) via l'interface web.

---

## Pipeline de Prospection

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SOURCING                                                     │
│    Adzuna, France Travail → prospect_signals (job_posting)      │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. SCORING & CLASSIFICATION                                    │
│    LLM évalue signals → prospect_signals.score                  │
│    Archivage automatique (top-15 vs archivés)                   │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ENRICHISSEMENT                                               │
│    FullEnrich → contact.linkedin_url, emails déduites           │
│    Brave Search + Apify → LinkedIn profile                      │
│    insee-sirene → company légales                               │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. AUDIT PATTERNS EMAIL                                         │
│    Pattern deduction : [first.last@company.fr](mailto:first.last@company.fr)           │
│    Double-check : FullEnrich vs patterns                        │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. VÉRIFICATION DÉLIVRABILITÉ                                   │
│    Bouncer / Reoon : valid / invalid / risky / disposable       │
│    Caching en email_verification_cache                          │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. GATE DE DÉLIVRABILITÉ                                        │
│    Règles : bouncer=valid → push                                │
│             bouncer=risky + pattern high → push (optionnel)     │
│             bounce_rate empirique > 0.15 → skip                 │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. OUTREACH / SMARTLEAD                                         │
│    Push prospect + email → Smartlead campaign                   │
│    Webhook : status updates (sent, bounced, replied, opened)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Structure Front-End

### Routing

L'app est une **SPA React** avec un seul route principal :

- **`/`** → Page `Prospection.tsx`
  - Onglets gérés par query param `?tab=triggers|personas|messages|campaigns|settings`
  - `AuthGate` wrapper global (redirection login si non authentifié)

### Composants Clés

```
src/
├── App.tsx                  — Router + providers (React Query, Theme, i18n)
├── pages/
│   └── Prospection.tsx      — Layout principal, onglets
├── components/
│   ├── auth/                — AuthGate, formulaires login/register
│   ├── prospection/         — Triggers, Personas, Messages, Campaigns
│   └── ui/                  — Radix UI + shadcn/ui (button, input, form, etc.)
├── hooks/
│   └── useProspectionData() — TanStack Query, mutation edge functions
├── lib/
│   └── supabase.ts          — Supabase client (SupabaseClient + real-time)
└── locales/                 — i18n FR/EN/NL
```

### États Globaux

- **TanStack Query** : cache requêtes, mutations edge functions
- **Supabase Auth** : session utilisateur, JWT token
- **Next Themes** : dark/light mode
- **React i18next** : traductions

---

## Structure Back-End

### Authentification

1. **`auth.users`** (géré par Supabase Auth) — email + password
2. **`profiles`** — extension auth.users (prénom, nom, plan courant)
3. **`workspaces`** — organisation (multi-tenant)
4. **`workspace_members`** — appartenance workspace + rôle (owner/admin/member/viewer)

**Fonction RLS helper :** `user_workspaces(min_role)` SECURITY DEFINER

```sql
-- Retourne les workspace_id où l'utilisateur a >= min_role
select workspace_id from public.workspace_members
where user_id = auth.uid()
  and role in ('owner', 'admin', ...);
```

### Tables de Prospection

**Prospects & Signaux :**
- `prospects` — identité (prénom, nom, email déduction)
- `prospect_signals` — signaux détectés (job_posting, company_growth, etc.)
- `prospect_profiles` — données enrichies (LinkedIn, taille entreprise, bouncer_status)
- `prospect_imports` — batches d'import (CSV, manuels)

**Entreprises & Patterns :**
- `companies` — enregistrement SIRENE (INSEE)
- `domain_email_patterns` — déduction [first.last@domain.fr](mailto:first.last@domain.fr) (ex. Acme Inc → acme.fr)
- `email_verification_cache` — résultats Bouncer/Reoon en cache

**Triggers, Personas, Templates :**
- `prospect_signal_triggers` — définition des signaux (RH en CDI → score 90+)
- `prospect_icp_personas` — critères de ciblage (secteur, géographie, taille)
- `prospect_message_templates` — templates de message (email, SMS, LinkedIn)

**Campagnes & Actions :**
- `prospect_batches` — batch de sourcing (une campagne = un batch)
- `prospect_enrichment_jobs` — queue d'enrichissement FullEnrich
- `prospect_actions` — actions (email envoyé, appel, etc.)
- `extension_tokens` — tokens pour l'extension Chrome (LinkedIn scraping)

**Configuration & Boîte à Outils :**
- `workspace_provider_credentials` — clés chiffrées (LLM, FullEnrich, Bouncer, Smartlead)
- `workspace_config` — JSON (modèles LLM, seuils scoring, etc.)
- `smartlead_campaigns` — mappings workspace → campagne Smartlead
- `recruitment_agencies_blacklist` — agences à exclure du scraping

### Edge Functions (38 total)

Chaque fonction est :
- Endpoint **HTTP** (POST, GET) ou **CRON** (job récurrent)
- Validation **Zod** sur inputs
- Auth **JWT** via `extractUserId()` (_shared)
- SSRF check via `validateUrlOrThrow()`
- CORS headers via `getCorsHeaders()`

#### Sourcing

| Fonction | Type | Rôle |
|----------|------|------|
| `scrape-job-signals` | HTTP POST | Déclenche le scrape Adzuna / France Travail |
| `poll-batch-reactive` | HTTP POST | Poll réactif batch (short-lived) |
| `poll-prospect-batches` | CRON (15 min) | Poll régulier des batches actifs |

#### Classification & Archivage

| Fonction | Type | Rôle |
|----------|------|------|
| `score-prospect-signals` | HTTP POST | LLM scoring + archivage top-15 |
| `detect-crm` | HTTP POST | Détecte le CRM de l'entreprise (signaux DNS/web) |
| `detect-import-mapping` | HTTP POST | Auto-détecte colonnes CSV lors d'import |

#### Enrichissement

| Fonction | Type | Rôle |
|----------|------|------|
| `enqueue-enrichment` | HTTP POST | File d'attente enrichissement FullEnrich |
| `fullenrich-webhook` | HTTP POST | Webhook FullEnrich (résultats) |
| `enrich-company` | HTTP POST | Enrichir company (INSEE, taille, secteur) |
| `enrich-deduced-emails` | HTTP POST | Deduire emails depuis patterns |
| `expand-prospect-profiles` | HTTP POST | Étendre profiles avec LinkedIn + Brave |
| `refresh-prospect-linkedin-snapshots` | HTTP POST | Mettre à jour snapshot LinkedIn |
| `reenrich-companies` | HTTP POST | Ré-enrichir companies (batch) |

#### Validation Email & Bouncer

| Fonction | Type | Rôle |
|----------|------|------|
| `bouncer-batch` | CRON (07h, 13h UTC) | Vérifie batch emails via Bouncer |
| `bouncer-webhook` | HTTP POST | Webhook Bouncer (résultats) |
| `bounce-learning` | CRON (04h UTC) | Apprentissage bounce_rate (améliore gate) |
| `fullenrich-credits-monitor` | CRON (06h UTC) | Alerte crédits FullEnrich bas |

#### Message Generation

| Fonction | Type | Rôle |
|----------|------|------|
| `generate-prospect-messages-bulk` | HTTP POST | Génère messages (email, SMS, LinkedIn) pour un batch |
| `regenerate-prospect-messages-from-template` | HTTP POST | Régénère depuis un template |

#### Outreach (Smartlead & SMTP)

| Fonction | Type | Rôle |
|----------|------|------|
| `send-via-smartlead` | HTTP POST | Push prospects → campagne Smartlead |
| `send-prospect-email` | HTTP POST | Envoi direct SMTP (optionnel) |
| `send-contact-email` | HTTP POST | Envoi email depuis l'app |
| `smtp-send-email` | HTTP POST | SMTP generic (Resend, transactionnel) |

#### Extension Chrome (LinkedIn Scraping)

| Fonction | Type | Rôle |
|----------|------|------|
| `extension-get-status` | HTTP POST | Récupère statut extension + list triggers actifs |
| `extension-linkedin-next` | HTTP POST | Récupère prochaine action LinkedIn (invite, message) |
| `extension-linkedin-update` | HTTP POST | Met à jour statut action (invité, erreur) |
| `extension-get-pending-actions` | HTTP POST | Liste actions en attente |
| `extension-update-action-status` | HTTP POST | Marque action comme done/failed |
| `extension-disconnect` | HTTP POST | Révoque l'extension |

#### Maintenance & Crons

| Fonction | Type | Rôle |
|----------|------|------|
| `cleanup-expired-prospects` | CRON (minuit UTC) | Archive prospects hors scope après 90j |
| `cleanup-expired-trials` | CRON (01h UTC) | Désactive workspaces essai expirés |
| `cleanup-stuck-crm-detections` | CRON (02h UTC) | Nettoie détections CRM orphelines |
| `linkedin-invitation-enqueue` | HTTP POST | File d'attente invitations LinkedIn |
| `weekly-prospect-recap` | CRON (lundi 08h UTC) | Email recap hebdomadaire |
| `prospect-weekly-recap` | CRON (variation) | Alias pour recap |
| `wipe-prospection-db` | HTTP POST | RESET DB (dev/test seulement) |

#### Admin

| Fonction | Type | Rôle |
|----------|------|------|
| `enqueue-prospect-import` | HTTP POST | File d'attente import CSV/JSON |
| `parse-import-freetext` | HTTP POST | Parse texte libre (copier-coller noms) |

**Module `_shared/` :** 53 fichiers Deno (TS). Voir [_shared/README.md](../supabase/functions/_shared/README.md) pour détail complet.

---

## Data Model (Simplifié)

### Utilisateur → Workspace → Prospects

```
auth.users (Supabase Auth)
    ↓
profiles (prénom, nom, plan)
    ↓
workspaces (1+ par utilisateur)
    ↓
workspace_members (rôle : owner/admin/member/viewer)
    ↓
prospects, prospect_signals, companies (RLS filtrées par workspace_id)
```

### RLS (Row-Level Security)

Toute table `prospect_*` ou `company_*` a une policy :

```sql
create policy "workspace read"
  on prospects for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));
```

Fonction helper SECURITY DEFINER `user_workspaces(min_role)` court-circuite la RLS de `workspace_members` pour éviter une recursion infinie.

### Chiffrement des Secrets

Clés API fournisseurs (Anthropic, FullEnrich, Bouncer, Smartlead) :
- **Table :** `workspace_provider_credentials`
- **Format :** `{ provider_id, workspace_id, encrypted_key }`
- **Chiffrage :** AES-GCM avec clé `TOKEN_ENCRYPTION_KEY` (secret Supabase)
- **Jamais en env** : chiffrement/déchiffrement côté edge function

Voir **[data-model.md](data-model.md)** pour le schéma complet.

---

## Flux Événements (Exemples)

### Sourcing → Scoring → Push

1. User clique « Lancer sourcing » (UI, onglet Triggers)
2. Appelle `scrape-job-signals` (HTTP) → crée `prospect_signals` (job_posting)
3. LLM score chaque signal → `prospect_signals.score`
4. Top-15 prospects gardés, autres archivés
5. User valide → archivage se finalize

### Enrichissement

1. User clique « Enrichir batch » (onglet Campaigns)
2. Appelle `enqueue-enrichment` → crée `prospect_enrichment_jobs`
3. CRON `poll-prospect-batches` vérifie toutes les 15 min
4. `fullenrich-webhook` peuple `prospect_profiles` (email_deduced, linkedin_url)
5. `expand-prospect-profiles` étend avec LinkedIn scrape (Apify)

### Email Gate → Smartlead

1. User clique « Vérifier délivrabilité »
2. CRON `bouncer-batch` (07h/13h) → appelle Bouncer API
3. `bouncer-webhook` peuple `prospect_profiles.bouncer_status`
4. `email-gate.ts` décide : valid → push, risky + pattern high → push optional, invalide → skip
5. User confirme → `send-via-smartlead` pousse vers campagne Smartlead

---

## Providers (Pluggable)

### LLM

- **Anthropic Claude** (Haiku, Sonnet) — par défaut
- **OpenAI compatible** (Mistral, etc.)
- **Demo** (test sans clé API)

Resolve : `resolveProvider(workspace_id, 'llm')` → LLMProvider instance

### Enrichement

- **FullEnrich** — entreprise + contact (email deduced, LinkedIn)
- **Brave Search** + **Apify** — LinkedIn profile scraping
- **INSEE SIRENE** — données légales françaises

### Email Validation

- **Bouncer** — vérification délivrabilité + apprentissage bounce_rate
- **Reoon** — arbitre des Bouncer unknown/risky

### Outreach

- **Smartlead** — campagne cold email, webhook statuts
- **SMTP direct** (Resend, etc.)

Voir **[providers.md](providers.md)** pour intégrer un nouveau provider.

---

## Configuration Multi-Tenant

### Plan Tiers

- **OSS** (gratuit) — 100 prospects/mois, sourcing limité, pas LLM payant
- **Growth** (payant) — 5k prospects/mois, tous providers
- **Business** (payant) — illimité, support

Gating via `subscription-access.ts`.

### Configuration Workspace

Stockée en `workspace_config` (JSONB) :

```json
{
  "llm_model": "claude-3-5-sonnet-20241022",
  "scoring_threshold": 0.7,
  "email_deduction_confidence": 0.85,
  "bounce_rate_threshold": 0.15,
  "archive_retention_days": 60
}
```

---

## Sécurité

### JWT & Auth

- Edge functions extraient user via `extractUserId(req)` (décoding JWT header)
- `subscription-access.ts` gate par plan
- CRON = `service_role` Bearer token (Supabase)

### SSRF Protection

Tout URL utilisateur passe par `validateUrlOrThrow()` (_shared)

### XSS Protection

- Redirections = chemins relatifs uniquement
- Emails HTML échappés via `escapeHtml()`

### CORS

`getCorsHeaders(req)` → headers CORS dynamiques (pas hardcoded `*`)

### RLS

Toute table prospect chiffrée par `workspace_id IN (SELECT user_workspaces(...))`

---

## Améliorations Futures

- [ ] Extraction en repo OSS standalone
- [ ] Intégration CRM bidirectionnelle (sync contacts)
- [ ] AI-powered follow-up (relances intelligentes)
- [ ] A/B testing templates
- [ ] Import direct depuis LinkedIn Sales Navigator

---

## Ressources

- **[data-model.md](data-model.md)** — Schéma SQL détaillé
- **[providers.md](providers.md)** — Intégrer nouveaux fournisseurs
- **[self-host.md](self-host.md)** — Deployer en production
- **[_shared/README.md](../supabase/functions/_shared/README.md)** — Modules Deno

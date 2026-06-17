> **Français** | [English](ARCHITECTURE.en.md)

# Architecture de Jay Reach

## Vue d'ensemble

Jay Reach est un **moteur de prospection B2B configurable** pour scraper, scorer et enrichir les prospects via cold email. Plateforme multi-tenant où chaque opérateur définit ses propres **déclencheurs** (annonces d'emploi à monitorer), **personas** (critères de ciblage), **templates** (messages) et **fournisseurs** (LLM, enrichissement, validation email, outreach).

Logique entièrement **agnostique** : aucune trace de produit spécifique. Chaque instance standalone configure ses clés API via l'interface web (onglet **Providers**).

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
│    FullEnrich : work_email, URL LinkedIn, métadonnées société   │
│    (Validation par pattern deduction locale)                    │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. VÉRIFICATION DÉLIVRABILITÉ                                   │
│    Bouncer (+ Reoon arbitrage) : valid/invalid/risky/disposable │
│    Apprentissage bounce_rate empirique                          │
└──────────────────────┬──────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. GATE EMAIL & OUTREACH                                        │
│    Filtrage règles (_shared/email-gate.ts)                      │
│    Push vers Smartlead (campagne résolue par persona_id)        │
│    Webhook : statuts envoi (sent, bounced, replied, opened)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture Front-End

### Routing

L'app est une **SPA React 18** avec un seul route principal :

- **`/`** → Page `Prospection.tsx`
  - Onglets (query param `?tab=`) : **Entreprises**, **Déclencheurs**, **Personas**, **Templates**, **Branding**, **Providers**, **Campagnes**
  - `AuthGate` wrapper global (redirection login si non authentifié)

### Composants Clés

```
src/
├── App.tsx                  — Router + providers (React Query, Theme, i18n)
├── pages/
│   └── Prospection.tsx      — Layout principal, onglets
├── components/
│   ├── auth/                — AuthGate, formulaires login/register
│   ├── prospection/         — triggers, personas, templates, campaigns, providers
│   └── ui/                  — Radix UI + shadcn/ui (button, input, form, etc.)
├── hooks/
│   └── useProspectionData() — TanStack Query, mutations edge functions
├── lib/
│   └── supabase.ts          — Supabase client + real-time listeners
└── locales/                 — i18n FR/EN/NL
```

### État Global & Librairies

- **TanStack Query (v5)** : cache requêtes, mutations edge functions
- **Supabase Auth native** : session utilisateur, JWT token
- **Next Themes** : dark/light mode
- **React Hook Form + Zod** : formulaires + validation
- **React i18next** : traductions multilingues
- **Tailwind CSS** : styling
- **shadcn/ui (Radix primitives)** : composants accessibles

---

## Architecture Back-End

### Authentification & Multi-Tenancy

1. **`auth.users`** (Supabase Auth natif) — email + password (signup/login)
2. **`profiles`** — extension (prénom, nom, plan courant)
3. **`workspaces`** — organisation multi-tenant
4. **`workspace_members`** — appartenance workspace + rôle (owner/admin/member/viewer)

**Fonction RLS helper :** `user_workspaces(min_role)` SECURITY DEFINER

```sql
-- Retourne workspace_id où l'utilisateur a >= min_role
select workspace_id from public.workspace_members
where user_id = auth.uid()
  and role in ('owner', 'admin', 'member', 'viewer');
```

### Tables de Prospection

**Prospects & Signaux :**
- `prospects` — identité prospect (prénom, nom, email)
- `prospect_signals` — signaux détectés (job_posting, etc.)
- `prospect_profiles` — données enrichies (work_email déduced, linkedin_url, deliverability_status)
- `prospect_imports` — batches d'import (CSV, paste libre)

**Entreprises & Patterns Email :**
- `companies` — métadonnées entreprise (secteur, taille, site web)
- `domain_email_patterns` — déduction locale de patterns (first.last@domain.fr)
- `email_verification_cache` — résultats Bouncer/Reoon (valid/invalid/risky/disposable)

**Configuration Prospection :**
- `prospect_signal_triggers` — déclencheurs (« Annonces RH », prompt LLM, seuil score)
- `prospect_icp_personas` — personas ciblés (nom, description, score boost)
- `prospect_message_templates` — templates email (variables, contenu)
- `smartlead_campaigns` — mapping persona_id → campagne Smartlead (clé **persona_id**)

**Campagnes & Queues :**
- `prospect_batches` — batch de sourcing (état : pending/processing/completed)
- `prospect_enrichment_jobs` — queue enrichissement FullEnrich
- `prospect_actions` — log actions (email envoyé, bounced, replied, etc.)

**Configuration & Credentials :**
- `workspace_provider_credentials` — **clés chiffrées** (Anthropic, FullEnrich, Bouncer, Smartlead)
- `workspace_config` — JSON config (LLM model, seuils, rétention archivage, etc.)
- `recruitment_agencies_blacklist` — agences exclus du scraping

**Détection CRM optionnelle :**
- `crm_detections` — signaux détectés (DNS CNAME, TXT, body homepage)
- `crm_detection_providers` — liste providers (Zoho, HubSpot, etc.)
- Toggle workspace `crm_detection_enabled` → active/désactive

### Edge Functions (30 total)

Chaque fonction est :
- Endpoint **HTTP** (POST, GET) OU **CRON** (job récurrent, schedulé en env Supabase)
- Validation **Zod** stricte sur inputs
- Auth **JWT** via `extractUserId()` (_shared) pour HTTP ; `service_role` Bearer token pour CRON
- SSRF check via `validateUrlOrThrow()` sur toute URL utilisateur
- CORS headers via `getCorsHeaders()` (jamais `*`)

⚠️ **Note self-host** : les CRON ne sont PAS planifiés par défaut. Voir [self-host.md](self-host.md) §planification pour `pnpm run setup:crons`.

#### Sourcing (Adzuna + France Travail)

| Fonction | Type | Rôle |
|----------|------|------|
| `scrape-job-signals` | HTTP POST | Déclenche scrape Adzuna / France Travail |
| `poll-batch-reactive` | HTTP POST | Poll réactif batch (short-lived) |
| `poll-prospect-batches` | **CRON** | Poll régulier des batches actifs (15 min) |

#### Scoring & Classification

| Fonction | Type | Rôle |
|----------|------|------|
| `score-prospect-signals` | HTTP POST | LLM scoring (prompt du trigger) + top-15 archivage |
| `detect-crm` | HTTP POST | Détecte CRM entreprise (DNS CNAME + fetch homepage + FullEnrich) |
| `detect-import-mapping` | HTTP POST | Auto-détecte colonnes CSV lors d'import |

#### Enrichissement (FullEnrich)

| Fonction | Type | Rôle |
|----------|------|------|
| `enqueue-enrichment` | HTTP POST | Enfile prospects vers FullEnrich |
| `fullenrich-webhook` | HTTP POST | Webhook FullEnrich (peuple prospect_profiles : work_email, linkedin_url) |
| `enrich-company` | HTTP POST | Enrichir company (taille, secteur) |
| `enrich-deduced-emails` | HTTP POST | Deduire emails depuis patterns locaux |
| `expand-prospect-profiles` | HTTP POST | Étendre profiles (utilisé pour non-FullEnrich) |
| `reenrich-companies` | HTTP POST | Ré-enrichir companies (batch) |

#### Validation Email (Bouncer + Reoon)

| Fonction | Type | Rôle |
|----------|------|------|
| `bouncer-batch` | **CRON** | Vérifie emails Bouncer (07h, 13h UTC) |
| `bouncer-webhook` | HTTP POST | Webhook Bouncer (peuple email_verification_cache, prospect_profiles.bouncer_status) |
| `bounce-learning` | **CRON** | Apprentissage bounce_rate empirique (04h UTC) |
| `fullenrich-credits-monitor` | **CRON** | Alerte crédits FullEnrich bas (06h UTC) |

#### Génération de Messages

| Fonction | Type | Rôle |
|----------|------|------|
| `generate-prospect-messages-bulk` | HTTP POST | Génère messages email pour batch (LLM ou template) |
| `regenerate-prospect-messages-from-template` | HTTP POST | Régénère depuis template |

#### Outreach (Smartlead)

| Fonction | Type | Rôle |
|----------|------|------|
| `send-via-smartlead` | HTTP POST | Push prospects → campagne Smartlead (résolue par **persona_id** dans `smartlead_campaigns`) |
| `smartlead-webhook` | HTTP POST | Webhook Smartlead (statuts : sent, bounced, replied, opened) |
| `list-smartlead-campaigns` | HTTP POST | Liste campagnes Smartlead (UI) |

#### Admin & Maintenance

| Fonction | Type | Rôle |
|----------|------|------|
| `cleanup-expired-prospects` | **CRON** | Archive prospects hors scope après 90j (minuit UTC) |
| `cleanup-stuck-crm-detections` | **CRON** | Nettoie détections CRM orphelines (02h UTC) |
| `weekly-prospect-recap` | **CRON** | Email recap hebdomadaire (lundi 08h UTC) |
| `prospect-weekly-recap` | **CRON** | Alias pour recap |
| `enqueue-prospect-import` | HTTP POST | File d'attente import CSV/JSON |
| `parse-import-freetext` | HTTP POST | Parse texte libre (copier-coller noms) |
| `set-provider-credential` | HTTP POST | Sauvegarde clé API provider (chiffrement AES-GCM) |
| `test-provider-connection` | HTTP POST | Teste connexion provider (Smartlead, FullEnrich, etc.) |
| `wipe-prospection-db` | HTTP POST | RESET DB (dev/test uniquement) |

**Module `_shared/` (Deno/TS)** : helpers partagés (auth, CORS, SSRF, email-gate, providers, encryption). Voir [_shared/README.md](../supabase/functions/_shared/README.md).

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
prospects, prospect_signals, companies, signals_triggers, icp_personas, message_templates
(RLS filtrées par workspace_id)
```

### Modèle Persona_ID (Cœur du Système)

L'architecture est centrée sur **persona_id** : chaque prospect est ciblé selon un **persona** particulier (ex. « Responsable RH », « Directeur Commercial »).

```
prospect_signal_triggers (déclencheurs)
  ├─ trigger_id, workspace_id, name, source (Adzuna / France Travail)
  ├─ scoring_prompt (LLM)
  └─ score_threshold

prospect_icp_personas (personas)
  ├─ persona_id, workspace_id, name, description
  └─ used in message templates + Smartlead campaigns

prospect_message_templates (templates)
  ├─ template_id, workspace_id, persona_id, subject, body
  └─ une template = un (persona_id, trigger_id) unique

smartlead_campaigns (mapping persistent)
  ├─ workspace_id, persona_id, smartlead_campaign_id
  └─ Une persona = une campagne Smartlead
```

**Flow :**
1. Trigger génère prospects + score LLM
2. User assigne prospects à un persona (onglet Campagnes)
3. `send-via-smartlead` résout la campagne Smartlead **par persona_id** dans `smartlead_campaigns`
4. Prospect est envoyé + webhook Smartlead met à jour statut

### RLS (Row-Level Security)

Toute table prospect chiffrée par workspace :

```sql
create policy "workspace_read"
  on prospects for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));
```

Fonction helper SECURITY DEFINER `user_workspaces(min_role)` court-circuite la RLS de `workspace_members` pour éviter récursion infinie.

### Chiffrement des Secrets (Token Encryption)

Clés API fournisseurs :
- **Table :** `workspace_provider_credentials`
- **Colonnes :** `workspace_id, provider_id (anthropic/openai_compatible/bouncer/fullenrich/smartlead/reoon), encrypted_key`
- **Chiffrage :** AES-256-GCM avec `TOKEN_ENCRYPTION_KEY` (secret Supabase)
- **Jamais en env** : déchiffrement côté edge function via `resolveCredential(workspace_id, provider_id)`

**Fallback env :** Si pas de clé en DB, essaie env vars (`ANTHROPIC_API_KEY`, `SMARTLEAD_API_KEY`, etc.).

Voir **[data-model.md](data-model.md)** pour le schéma SQL détaillé.

---

## Flux Événements (Exemples)

### Sourcing → Scoring

1. User configure **Déclencheur** (onglet Déclencheurs) : nom, source (Adzuna/France Travail), prompt LLM, seuil
2. User clique « Lancer sourcing »
3. `scrape-job-signals` → scrape Adzuna/France Travail
4. `score-prospect-signals` → LLM évalue chaque annonce (prompt du déclencheur)
5. Top-15 prospects conservés ; autres archivés (récupérables plus tard)

### Enrichissement

1. User clique « Enrichir » (onglet Campagnes)
2. `enqueue-enrichment` → crée `prospect_enrichment_jobs` (FullEnrich)
3. CRON `poll-prospect-batches` poll toutes les 15 min
4. FullEnrich résout work_email + linkedin_url → `fullenrich-webhook` peuple `prospect_profiles`
5. Patterns locaux complètent si nécessaire

### Vérification Email & Gate

1. `bouncer-batch` (CRON 07h/13h) → appelle Bouncer API
2. `bouncer-webhook` peuple `email_verification_cache` + `prospect_profiles.bouncer_status` (valid/invalid/risky/disposable)
3. `bounce-learning` (CRON 04h) améliore empirical bounce_rate par domaine
4. `email-gate.ts` filtre :
   - `bouncer_status=valid` → **push**
   - `bouncer_status=risky` + pattern high conf (≥0.85-0.90) → **push optionnel**
   - empirical bounce_rate > 0.15 sur domaine → **skip**

### Outreach Smartlead (persona_id-based)

1. User assigne prospects à un **persona** (ex. « Responsable RH »)
2. User configure mapping persona → campagne Smartlead (onglet Campagnes)
3. User confirme → `send-via-smartlead` pousse vers campagne (résolue **par persona_id**)
4. `smartlead-webhook` reçoit statuts : sent, bounced, replied, opened → peuple `prospect_actions`

### Détection CRM (Optionnel)

Si `crm_detection_enabled` en workspace :
1. User déclenche « Détecter CRM » (onglet Entreprises)
2. `detect-crm` scanne DNS (CNAME, TXT), fetch homepage (SSRF-safe), interroge FullEnrich
3. Détecte signaux CRM (Zoho, HubSpot, Pipedrive, etc.)
4. Peuple `crm_detections` (aide décision, pas de blocage)

---

## Providers (Pluggables)

Chaque provider est :
- Configuré **par workspace** (clés chiffrées en `workspace_provider_credentials`)
- Résolu via `resolveCredential(workspace_id, provider_id)` → déchiffre + fallback env
- **Demo** provider pour tests sans clés (env `DEMO_MODE=true`)

### LLM (Scoring)

- **`anthropic`** (défaut) — Haiku, Sonnet (Claude 3.5)
- **`openai_compatible`** — Mistral, autres

### Enrichissement

- **`fullenrich`** — ✅ seul fournisseur (work_email, linkedin_url, company metadata)

### Validation Email

- **`bouncer`** — délivrabilité + apprentissage bounce_rate
- **`reoon`** — arbitre Bouncer unknown/risky (optionnel)

### Outreach

- **`smartlead`** — ✅ seul fournisseur outreach (cold email)

### Détection CRM (Optionnel)

- **DNS scanning** : CNAME, TXT (Zoho, HubSpot, Pipedrive, etc.)
- **Web scraping SSRF-safe** : fetch homepage, parse signaux
- **FullEnrich** : signaux supplémentaires

Voir **[providers.md](providers.md)** pour ajouter un nouveau provider.

---

## Configuration Multi-Tenant

### Plans (Substrat Paywall)

La plateforme supporte des plans (gratuit/payant). En **OSS self-host**, le paywall est **no-op** (pas de subscription actifs). Structure présente pour compat future :

- Gating via `subscription-access.ts` (vérifie plan workspace)
- En self-host : tous les plans = accès complet
- Endpoints publics (signup, webhooks) gérés strictement

### Configuration Workspace

Stockée en `workspace_config` (JSONB) :

```json
{
  "llm_model": "claude-3-5-sonnet-20241022",
  "llm_provider": "anthropic",
  "scoring_threshold": 0.7,
  "email_deduction_confidence": 0.85,
  "bounce_rate_threshold": 0.15,
  "archive_retention_days": 60,
  "crm_detection_enabled": false
}
```

**Onglets Branding** : logo, couleurs, domaine email, footer custom (pour outreach perso).

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

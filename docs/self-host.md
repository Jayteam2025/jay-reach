> **Français** | [English](self-host.en.md)

# Guide Complet Self-Host — Jay Reach

Déployez votre propre instance Jay Reach de zéro : clone, configuration, lancement local, intégration des providers, automatisation des tâches.

---

## Prérequis

### Logiciels obligatoires

| Composant | Version | Installation |
|-----------|---------|--------------|
| **Node.js** | ≥ 22.12 | https://nodejs.org |
| **pnpm** | ≥ 10.0.0 | `npm install -g pnpm` ou via Homebrew |
| **Supabase CLI** | latest | `brew install supabase/tap/supabase` (macOS) ou `npm install -g supabase` |
| **Git** | latest | https://git-scm.com |

### Vérifier vos installations

```bash
node --version          # v22.x.x ou plus
pnpm --version          # 10.x.x ou plus
supabase --version      # 2.x.x ou plus
git --version           # 2.x.x ou plus
```

### Compte Supabase Cloud

1. Allez à https://supabase.com
2. Créez un compte (gratuit)
3. Créez un **nouveau projet**
4. **Conservez ces informations :**
   - **URL du projet** : `https://VOTRE-REF.supabase.co` (Settings → API → Project URL)
   - **Anon key** : clé publique (Settings → API → Anon key)
   - **Project Ref** : l'ID dans l'URL (ex. `abc123defghijklmnopq`)
   - **Database password** : défini lors de la création

> **Note :** Supabase Cloud est obligatoire (pas de local pour self-host). Pour explorer en local d'abord, utilisez `supabase start` (Docker) sur une branche de test.

---

## Étape 1 : Cloner le Repository

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
```

---

## Étape 2 : Installer les Dépendances

```bash
pnpm install
```

**pnpm** utilise un store partagé, donc les installations ultérieures sont très rapides. Ne pas utiliser `npm install` ou `yarn`.

---

## Étape 3 : Configuration Environnement

### Créer le fichier `.env`

```bash
cp .env.example .env
```

### Compléter les variables

Ouvrez `.env` avec un éditeur de texte et remplissez les champs suivants. Les **clés providers** ne vont **PAS** ici (voir §Secrets Edge Functions).

```bash
# === FRONT-END (publiques, visibles dans le navigateur) ===
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === BACK-END (utilisé uniquement par `pnpm run setup` et `pnpm run doctor`) ===
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SUPABASE_PROJECT_REF=YOUR-PROJECT-REF
SUPABASE_DB_PASSWORD=YOUR_DATABASE_PASSWORD
```

#### Détail de chaque variable

**1. VITE_SUPABASE_URL**
- Source : Dashboard Supabase → Votre projet → Settings → API → "Project URL"
- Format : `https://abc123xyz.supabase.co`

**2. VITE_SUPABASE_ANON_KEY**
- Source : Dashboard Supabase → Settings → API → "Anon key (public)"
- C'est la clé **publique**, **pas** la clé service_role

**3. SUPABASE_ACCESS_TOKEN**
- Source : https://supabase.com/dashboard/account/tokens
- Cliquez "Generate new token"
- Copiez le token complet (commence par `sbp_`)
- ⚠️ **Permissions requises :** "Functions: Deploy + Manage", "Database"

**4. SUPABASE_PROJECT_REF**
- L'ID du projet (ex. `abc123defghijklmnopq`)
- Visible dans l'URL du dashboard : `https://app.supabase.com/project/{REF}`
- Ou Settings → General → Project Reference ID

**5. SUPABASE_DB_PASSWORD**
- Fourni lors de la création du projet
- Ou réinitialisé via Supabase Dashboard → Settings → Database → Reset Password

> **Sécurité :** `.env` est **gitignoré**. Ne jamais le commiter.

---

## Étape 4 : Vérification de Santé

Avant de configurer, vérifiez que tout est en place :

```bash
pnpm run doctor
```

Cela vérifie :
- ✓ Node.js ≥ 22.12
- ✓ pnpm ≥ 10.0.0
- ✓ Supabase CLI disponible
- ✓ Accès à votre projet Supabase (via `.env`)
- ✓ Connectivité Internet

**Erreurs courantes et solutions :**

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Supabase CLI not found` | CLI non installée | `npm install -g supabase` |
| `VITE_SUPABASE_URL undefined` | `.env` incomplet | Relire §Compléter les variables ci-dessus |
| `Invalid SUPABASE_ACCESS_TOKEN` | Token périmé ou mauvais | Régénérez à https://supabase.com/dashboard/account/tokens |
| `Database connection failed` | Password incorrect ou IP bloquée | Vérifiez `SUPABASE_DB_PASSWORD`, et que votre IP n'est pas bloquée |

---

## Étape 5 : Setup Initial — Base & Edge Functions

```bash
pnpm run setup
```

Ce script effectue **automatiquement** :

1. **Lien au projet Supabase** — lie votre `.env` au projet cloud
2. **Migrations SQL** — crée tables, schéma RLS, fonctions stockées
3. **Génération du secret de chiffrement** — `TOKEN_ENCRYPTION_KEY` déployé en Edge Functions (pour chiffrer les clés providers en BDD)
4. **Déploiement des 31 edge functions** — Deno functions réactives du pipeline (peut prendre 3-5 min)
5. **Initialisation du workspace** — créé le "workspace" multi-tenant par défaut (tenant = votre instance)

**Durée :** 3–5 minutes (première fois)

**Sortie attendue :**
```
✓ Migrations appliquées
✓ Edge Functions déployées (31/31)
✓ Secret de chiffrement généré
✓ Workspace créé
✓ Prêt à démarrer
```

**Erreurs fréquentes :**

| Erreur | Solution |
|--------|----------|
| "Migrations appliquées : 0/17" | Vérifiez `SUPABASE_DB_PASSWORD`, puis relancez |
| "Failed to deploy function X" | Redéployez : `supabase functions deploy <fn-name> --no-verify-jwt` |

---

## Étape 6 : Lancer le Serveur de Développement

```bash
pnpm dev
```

Démarre Vite sur `http://localhost:8080`.

Ouvrez votre navigateur et allez à **http://localhost:8080**.

---

## Étape 7 : Créer Votre Premier Utilisateur (Admin)

1. Cliquez **"S'inscrire"** (ou Sign Up)
2. Entrez un email (ex. `admin@example.com`) et un mot de passe
3. Confirmez
4. Vous êtes connecté et redirigé vers l'onglet **Prospection**

> **Important :** Le premier utilisateur est automatiquement **admin** du workspace. Tous les utilisateurs créés ensuite sont dans le même workspace.

---

## Étape 8 : Secrets Edge Functions

Certains services optionnels nécessitent des secrets qui ne vont **pas** dans `.env` (ils ne doivent pas être en local). Ils se déploient directement sur Supabase via Supabase CLI.

### TOKEN_ENCRYPTION_KEY (automatique)

Généré et déployé par `pnpm run setup`. Ne rien faire.

### Optionnels : Notifications & Webhooks

#### A. Resend (notifications internes — hebdo + alerte crédits)

Si vous souhaitez recevoir des emails de recap hebdo ou d'alerte sur les crédits FullEnrich :

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxx --project-ref <votre-ref>
supabase secrets set RESEND_FROM=noreply@yourdomain.com --project-ref <votre-ref>
supabase secrets set ALERT_RECIPIENTS=admin@example.com,ops@example.com --project-ref <votre-ref>
```

(Obtener clé : https://resend.com/api-keys)

#### B. Smartlead Webhook (optionnel — suivi des réponses)

Si vous voulez que Smartlead mette à jour vos statuts de campagne automatiquement :

```bash
supabase secrets set SMARTLEAD_WEBHOOK_SECRET=your_webhook_secret --project-ref <votre-ref>
```

> Ces secrets sont **chiffrés** en transit et en stockage Supabase.

---

## Étape 9 : Configurer les Providers

Toutes les clés API se saisissent **dans l'app**, onglet **Configuration** → **Providers**. Jamais dans `.env`.

### Mode Démo (sans clés)

L'app fonctionne **entièrement en mode démo** sans aucune clé configurée. Des données fictives réalistes sont générées pour explorer. C'est parfait pour apprendre.

### LLM (Obligatoire — évaluation des signaux)

**Anthropic Claude (par défaut) :**

1. Allez à https://console.anthropic.com/account/api-keys
2. Cliquez "Create Key"
3. Copiez la clé complète
4. Dans l'app : **Configuration** → **LLM** → **Anthropic Claude**
5. Collez votre clé
6. Sélectionnez le modèle (défaut : `claude-3-5-sonnet-20241022`) — bon balance coût/qualité
7. Cliquez **Tester** pour vérifier
8. Sauvegardez

**Modèles disponibles :**
- `claude-3-5-sonnet-20241022` ⭐ recommandé (équilibre coût/qualité)
- `claude-3-5-haiku-20241022` (rapide, budget)
- `claude-3-opus-20250219` (puissant, coûteux)

**Alternative :** OpenAI-compatible (Mistral, etc.) — voir [providers.md](providers.md)

**Coûts :** Environ $0.003 par signal évalué

### Sourcing (Adzuna + France Travail)

Intégrés nativement. Ils recherchent des offres d'emploi publiques **gratuitement**.

- **Adzuna** : https://developer.adzuna.com
  - Dans l'app : **Configuration** → **Sources** → **Adzuna**
  - Vous aurez un `app_id` et `app_key`
  - (Gratuit pour débuter)

- **France Travail** : https://francetravail.io
  - Dans l'app : **Configuration** → **Sources** → **France Travail**
  - Vous aurez `client_id` et `client_secret`
  - (Gratuit)

### Enrichissement (FullEnrich — emails & LinkedIn)

Enrichit chaque prospect avec adresse email, profil LinkedIn, données entreprise.

1. Allez à https://app.fullenrich.com/settings/api
2. Copiez votre clé API
3. App : **Configuration** → **Enrichissement** → **FullEnrich**
4. Collez la clé
5. Testez
6. Sauvegardez

**Coûts :** $0.01–$0.02 par prospect (gratuit les 100 premiers)

### Validation Email (Bouncer — délivrabilité)

Prédit les bounces avant d'envoyer, économise les crédits Smartlead.

1. Allez à https://usebouncer.com/dashboard
2. Copiez votre clé API
3. App : **Configuration** → **Validation Email** → **Bouncer**
4. Collez la clé
5. Testez
6. Sauvegardez

**Coûts :** $0.005 par email vérifié (gratuit les 100 premiers)

### Outreach (Smartlead — envoi campagnes froides)

Seul canal d'envoi pour les campagnes email.

1. Allez à https://smartlead.ai/settings/api
2. Copiez votre clé API
3. App : **Configuration** → **Outreach** → **Smartlead**
4. Collez la clé
5. Testez
6. Sauvegardez

**Coûts :** À partir de $59/mois (warm-up + envois)

**Mapping Persona → Campagne Smartlead :**
Après configuration, allez à **Configuration** → **Campagnes** et mappez chaque persona (RH, Directeur, Commercial, etc.) à une campagne Smartlead.

---

## Étape 10 : Lancer Votre Première Campagne

### 1. Créer un Trigger (détecteur de signaux)

1. **Prospection** → **Triggers**
2. **+ Ajouter un trigger**
3. Remplissez :
   - **Nom** : `Test RH CDI`
   - **Type** : `job_posting`
   - **Filtres** :
     - Titre : `Responsable RH|Chef RH|Directeur RH`
     - Contrat : `CDI`
   - **Multiplicateur score** : `1.0`
4. Sauvegardez

### 2. Créer une Persona (profil cible)

1. **Prospection** → **Personas**
2. **+ Ajouter une persona**
3. Remplissez :
   - **Nom** : `Test RH France`
   - **Titres** : `Directeur RH|Chef RH|Responsable Talents`
   - **Secteurs** : `Tech|Finance|Retail` (optionnel)
   - **Pays** : `France`
4. Sauvegardez

### 3. Lancer le sourcing

1. **Prospection** → **Sourcing**
2. Sélectionnez votre **Trigger** + **Persona**
3. **Démarrer sourcing**
4. Attendez 2–3 minutes (scrape Adzuna + France Travail)
5. Vérifiez l'onglet **Prospects** pour voir les résultats

### 4. Enrichir les prospects

1. **Enrichissement**
2. Sélectionnez votre batch
3. **Enrichir** (appelle FullEnrich)
4. Attendez le webhook (2–5 min par prospect)
5. Vérifiez **Enrichissement** → votre batch pour voir emails + LinkedIn

### 5. Valider les emails

1. **Audit Emails**
2. **Vérifier délivrabilité** (appelle Bouncer)
3. Attendez les résultats (valid / risky / invalid)
4. Filtrez par "valid" pour garder les meilleurs

### 6. Envoyer via Smartlead

1. **Campagnes**
2. Sélectionnez les prospects "valid"
3. **Envoyer vers Smartlead**
4. Suivi en temps réel (réponses, bounces, clics)

---

## Étape 11 : Planification des Tâches (Crons) — Optionnel

Par défaut, le pipeline cœur fonctionne **sans aucun cron** (scrape déclenché manuellement, enrichissement asynchrone via webhooks). Mais pour automatiser les tâches récurrentes, activez les crons :

### Script de Planification

```bash
pnpm run setup:crons
```

Cela configure (via **pg_cron** Supabase) les jobs automatiques :

| Job | Fréquence | Rôle |
|-----|-----------|------|
| **enrichment_poll** | Toutes les 15 min | Poll les webhooks FullEnrich en suspens |
| **bouncer_batch** | 07h + 13h UTC | Batch Bouncer des emails en attente |
| **bounce_learning** | 04h UTC | Met à jour patterns bounce empiriques |
| **credit_alerts** | 06h UTC | Alerte si crédits FullEnrich < 20% |
| **recap_weekly** | Lundi 08h UTC | Email récap hebdo (via Resend) |
| **cleanup_retention** | Quotidien 02h UTC | Supprime prospects archivés > 60 jours |

> ℹ️ Vous pouvez aussi déclencher ces jobs manuellement via l'UI ou l'API.

### Alternative : Crons Manuels (supabase CLI)

Si vous préférez contrôler les crons vous-même :

```bash
# Vérifier les crons existants
supabase functions list

# Déclencher un job manuellement (exemple)
supabase functions invoke bouncer-batch --project-ref <ref> \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

> **Note :** `setup:crons` et son alternative manuelle ne sont qu'un commodity. Le funnel **marche sans** — sourcing + enrichissement + validation se font à la demande via l'UI.

---

## Durcissement & Sécurité Post-Deployment

### Activer la Détection de Mot de Passe Compromis

Supabase peut vérifier si un mot de passe est sur **Have I Been Pwned** (HIBP) :

1. Dashboard Supabase → **Authentication** → **Password compromised detection**
2. Activez

### Checklist

- [ ] `.env` est **gitignoré** (vérifiez `.gitignore`)
- [ ] Pas de secret hardcodé dans le code (`pnpm run check:hardcodes`)
- [ ] RLS activées sur **toutes** les tables (Dashboard → SQL Editor → run default RLS creation)
- [ ] **Domaine personnalisé configuré** (DNS CNAME vers Vercel/Netlify/Docker)
- [ ] **Sauvegarde Supabase** activée (Dashboard → Backups)
- [ ] **Monitoring** configuré (Sentry, CloudWatch, etc.)

---

## Dépannage

### `pnpm run setup` échoue

**Symptôme :** "Migrations applied: 0/17" ou "Connection refused"

**Solutions :**
1. Vérifiez `.env` :
   ```bash
   grep "SUPABASE_" .env
   ```
2. Testez la connexion manuellement :
   ```bash
   supabase status --project-ref <ref>
   ```
3. Vérifiez permissions du token (doit avoir "Functions Deploy" + "Database")
4. Réinitialisez le password DB via Supabase Dashboard → Settings → Reset Password

### `pnpm dev` ne démarre pas

**Symptôme :** "Port 8080 already in use" ou "VITE_* undefined"

**Solutions :**
1. Vérifiez `.env` complet (toutes les `VITE_*` variables)
2. Tuez le port :
   ```bash
   lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9
   ```
3. Relancez `pnpm dev`

### Signup échoue

**Symptôme :** "Email already exists" ou "JWT invalid"

**Solutions :**
1. Vérifiez que Supabase Auth est activée (Dashboard → Authentication → Providers → Email)
2. Vérifiez `VITE_SUPABASE_ANON_KEY` est la **public key** (pas service_role)
3. Pour tester local : `supabase db reset --project-ref <ref>` (destructif)

### Edge Functions ne déploient pas

**Symptôme :** "Failed to deploy function X"

**Solutions :**
1. Vérifiez le quota Edge Functions (Dashboard → Edge Functions → Quotas)
2. Vérifiez permissions du token
3. Redéployez individuellement :
   ```bash
   supabase functions deploy webhook-enrichment --no-verify-jwt --project-ref <ref>
   ```
4. Vérifiez la syntaxe Deno :
   ```bash
   deno check supabase/functions/webhook-enrichment/index.ts
   ```

---

## Déploiement en Production

### Hébergement Front-End

**Option 1 : Vercel (recommandé)**

```bash
npm install -g vercel
vercel
```

Suivez les prompts. Vercel configure automatiquement les variables `VITE_*`.

**Option 2 : Netlify**

```bash
npm install -g netlify-cli
netlify deploy
```

**Option 3 : Docker (auto-hébergement)**

```bash
docker build -t jay-reach .
docker run -p 80:8080 -e VITE_SUPABASE_URL=... -e VITE_SUPABASE_ANON_KEY=... jay-reach
```

### Supabase Production

1. Créez un **nouveau projet Supabase** pour la prod (pas de re-partage du dev)
2. Mettez à jour `.env` avec les clés du projet prod
3. Lancez `pnpm run setup` (le liera au nouveau projet)
4. Déployez les edge functions : `supabase functions deploy --project-ref <prod-ref>`

### SSL/HTTPS

- **Vercel/Netlify** : automatique
- **Docker** : configurez un proxy Nginx + Let's Encrypt

---

## Ressources

- **[README.md](../README.md)** — Démarrage rapide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Pipeline de prospection, edge functions
- **[data-model.md](data-model.md)** — Schéma DB, RLS
- **[providers.md](providers.md)** — Détails techniques des intégrations
- **[Supabase Docs](https://supabase.com/docs)** :
  - [Edge Functions](https://supabase.com/docs/guides/functions)
  - [Database](https://supabase.com/docs/guides/database)
  - [Auth](https://supabase.com/docs/guides/auth)

---

## Support

- **Bug ou Idée :** Ouvrez une [Issue](https://github.com/Jayteam2025/jay-reach/issues)
- **Sécurité :** [SECURITY.md](../SECURITY.md)
- **Contribution :** [CONTRIBUTING.md](../CONTRIBUTING.md)

Bonne prospection !

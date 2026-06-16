# Guide Complet Self-Host — Jay Reach

Ce guide vous guide pas à pas pour déployer votre propre instance Jay Reach, de la configuration locale à la production.

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

### Compte Supabase

1. Allez à https://supabase.com
2. Créez un compte (gratuit)
3. Créez un nouveau projet
4. **Notez :**
   - URL du projet (Settings → API → Project URL)
   - Anon key (Settings → API → anon key / public key)
   - Project Ref (l'ID dans l'URL, ex. `VOTRE-REF-PROJET`)
   - Database password (visible lors de la création)

> **Conseil :** Si vous explorez localement d'abord, utilisez `supabase start` (Docker local). Pour la prod, utilisez Supabase Cloud.

---

## Étape 1 : Cloner le Repo

```bash
git clone https://github.com/Jayteam2025/jay-reach.git
cd jay-reach
```

---

## Étape 2 : Installer les Dépendances

```bash
pnpm install
```

Cela installe tous les packages (React, Vite, Supabase, Deno, etc.). Pnpm utilise un store partagé, donc les installs suivantes sont rapides.

> **Problème courant :** Évitez `npm install` (legacy) ou `yarn`. Utilisez **toujours pnpm**.

---

## Étape 3 : Configuration Environnement

### Copier le template `.env`

```bash
cp .env.example .env
```

### Remplir les variables

Ouvrez `.env` avec votre éditeur et complétez :

```bash
# Front-end (visibles dans le navigateur, publiques)
VITE_SUPABASE_URL=https://VOTRE-REF-PROJET.supabase.co
VITE_SUPABASE_ANON_KEY=VOTRE_CLE_ANON_PUBLIQUE

# Back-end (utilisé par pnpm setup seulement)
SUPABASE_ACCESS_TOKEN=VOTRE_TOKEN_CLI
SUPABASE_PROJECT_REF=VOTRE-REF-PROJET
SUPABASE_DB_PASSWORD=VOTRE_MOT_DE_PASSE_DB
```

**Où obtenir chaque clé :**

1. **VITE_SUPABASE_URL** et **VITE_SUPABASE_ANON_KEY**
   - Dashboard Supabase → Votre projet → Settings → API
   - Copiez "Project URL" et "Anon key (public)"

2. **SUPABASE_ACCESS_TOKEN**
   - https://supabase.com/dashboard/account/tokens
   - Créez un nouveau token d'accès
   - Copier le token complet (commence par `sbp_`)

3. **SUPABASE_PROJECT_REF**
   - C'est l'ID dans l'URL du dashboard (ex. `abc123defg45hijkl`)
   - Ou allez à Settings → General → Project Reference ID

4. **SUPABASE_DB_PASSWORD**
   - Visible lors de la création du projet
   - Ou réinitialisez-le via Database Settings → Reset Database Password

> **Sécurité :** `.env` est dans `.gitignore` — jamais commité.

---

## Étape 4 : Vérification de Santé

```bash
pnpm doctor
```

Cela vérifie :
- ✓ Node.js ≥ 22.12
- ✓ pnpm ≥ 10.0.0
- ✓ Supabase CLI
- ✓ Accès à votre projet Supabase
- ✓ Connectivité Internet

**Erreurs courantes :**

| Erreur | Solution |
|--------|----------|
| `Supabase CLI not found` | `npm install -g supabase` |
| `Invalid SUPABASE_ACCESS_TOKEN` | Régénérez à https://supabase.com/dashboard/account/tokens |
| `Database connection failed` | Vérifiez `SUPABASE_DB_PASSWORD` + IP whitelist |

---

## Étape 5 : Setup Initial

```bash
pnpm setup
```

Cela :
1. **Applique les migrations SQL** — crée tables, RLS, fonctions
2. **Génère la clé de chiffrement** — `TOKEN_ENCRYPTION_KEY` (secrets providers)
3. **Déploie les 38 edge functions** — (peuvent prendre 2-3 min)
4. **Crée le workspace initial** — tenant multi-tenant
5. **Prépare l'authentification** — auth.users + profiles

**Durée estimée :** 3-5 minutes (première fois)

**Après succès, vous verrez :**
```
✓ Migrations appliquées (17 fichiers)
✓ Edge Functions déployées (38/38)
✓ Clé de chiffrement générée
✓ Workspace créé : "Mon Instance"
✓ Prêt pour pnpm dev
```

---

## Étape 6 : Lancer Localement

```bash
pnpm dev
```

Ouvre le serveur de dev Vite sur `http://localhost:8080`.

Dans votre navigateur, visitez **http://localhost:8080**.

---

## Étape 7 : S'Inscrire

1. Cliquez **"S'inscrire"**
2. Entrez un email (ex. `test@example.com`) et un mot de passe
3. Vous êtes redirigé vers l'onglet **Prospection** (vide au début)
4. Ouvrez l'onglet **Configuration** (icône roue) pour brancher les providers

---

## Étape 8 : Configuration des Providers

Pour prospérer, vous avez besoin de clés API pour les services tiers. **Toutes les clés se saisissent dans l'app, onglet Config** (jamais dans `.env`).

### LLM (Obligatoire pour évaluer les signaux)

**Anthropic Claude (par défaut) :**

1. Allez à https://console.anthropic.com/account/api-keys
2. Créez une clé API
3. Dans l'app, onglet **Configuration** → **LLM** → **Anthropic Claude**
4. Collez votre clé
5. Sélectionnez le modèle (par défaut : `claude-3-5-sonnet-20241022`)

### Enrichissement (FullEnrich — email deduction + LinkedIn)

1. Allez à https://app.fullenrich.com/settings/api
2. Copiez votre clé API
3. App **Configuration** → **Enrichissement** → **FullEnrich**
4. Collez la clé

**Coûts :** $0.01–0.02 par prospect (gratuit les 100 premiers)

### Validation Email (Bouncer — délivrabilité)

1. Allez à https://usebouncer.com/dashboard
2. Copiez votre clé API
3. App **Configuration** → **Validation Email** → **Bouncer**
4. Collez la clé

**Coûts :** $0.005 par email (gratuit les 100 premiers)

### Outreach (Smartlead — campagnes cold email)

1. Allez à https://smartlead.ai/settings/api
2. Copiez votre clé API
3. App **Configuration** → **Outreach** → **Smartlead**
4. Collez la clé

**Coûts :** À partir de $59/mois pour warm-up + envois

---

## Étape 9 : Première Campagne (Test)

### Créer un Trigger (Détecteur de Signaux)

1. Onglet **Prospection** → sous-onglet **Triggers**
2. Cliquez **+ Ajouter un trigger**
3. Nom : `Test RH CDI`
4. Type : `job_posting`
5. Filtres :
   - Titre : `Responsable RH|Chef RH|Directeur RH`
   - Contrat : `CDI`
6. Score multiplicateur : `1.0`
7. Sauvegardez

### Créer une Persona (Critères de Ciblage)

1. Onglet **Prospection** → sous-onglet **Personas**
2. Cliquez **+ Ajouter une persona**
3. Nom : `Test RH France`
4. Titres : `Directeur RH|Chef RH|Responsable Talents`
5. Secteurs : `Tech|Finance|Retail` (optionnel)
6. Géographies : `France`
7. Sauvegardez

### Lancer le Sourcing

1. Onglet **Prospection** → sous-onglet **Sourcing**
2. Sélectionnez votre trigger + persona
3. Cliquez **Démarrer sourcing**
4. Attendez 2-3 minutes (scrape Adzuna + France Travail)
5. Vous verrez les prospects détectés

### Évaluation & Enrichissement

1. Onglet **Enrichissement**
2. Sélectionnez un batch
3. Cliquez **Enrichir** (FullEnrich + LinkedIn)
4. Attendez le webhook (2-5 min par prospect)

### Validation Email

1. Onglet **Audit Emails**
2. Cliquez **Vérifier délivrabilité** (Bouncer batch)
3. Voir les résultats (valide/risky/invalide)

### Push Smartlead

1. Onglet **Campagnes**
2. Sélectionnez les prospects validés
3. Cliquez **Envoyer vers Smartlead**
4. Suivi des réponses en temps réel

---

## Déploiement en Production

### Hébergement Front-End

**Option 1 : Vercel (recommandé)**

```bash
npm install -g vercel
vercel
```

Suivez les prompts. Vercel configure automatiquement la CI/CD.

**Option 2 : Netlify**

```bash
npm install -g netlify-cli
netlify deploy
```

**Option 3 : Docker (auto-hébergement)**

```bash
docker build -t jay-reach .
docker run -p 80:8080 -e VITE_SUPABASE_URL=... jay-reach
```

### Supabase Production

1. Utilisez **Supabase Cloud** (https://supabase.com) — pas de "local"
2. Mettez à jour `.env` avec les clés du projet de prod
3. Redéployez les edge functions :

```bash
supabase functions deploy --project-ref <prod-ref>
```

### SSL/HTTPS

- **Vercel/Netlify** : HTTPS automatique
- **Docker** : Configurez un reverse proxy Nginx + Let's Encrypt

### Monitoring

Supabase Dashboard offre :
- Logs des edge functions
- Monitoring de la DB
- Real-time activity

---

## Troubleshooting

### `pnpm setup` échoue

**Problème :** "Migrations appliquées : 0/17"

**Solutions :**
1. Vérifiez `SUPABASE_ACCESS_TOKEN` (valide et permissions allouées)
2. Vérifiez `SUPABASE_PROJECT_REF` (matches l'ID du projet)
3. Réinitialisez le mot de passe DB (Supabase Dashboard → Settings → Reset Password)
4. Testez la connection :
   ```bash
   supabase status --project-ref <ref>
   ```

### `pnpm dev` ne lance pas

**Problème :** "Port 8080 already in use" ou "VITE_SUPABASE_URL undefined"

**Solutions :**
1. Vérifiez que `.env` est bien rempli (`VITE_*` variables)
2. Tuez le processus sur le port 8080 :
   ```bash
   lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9
   ```
3. Relancez `pnpm dev`

### Signup échoue

**Problème :** "Email already exists" ou JWT invalid

**Solutions :**
1. Supabase Auth doit être activé (Settings → Authentication → Enable)
2. Vérifiez que `VITE_SUPABASE_ANON_KEY` est la **public key** (pas service_role)
3. Réinitialisez la base : `supabase db reset --project-ref <ref>` (destructif, dev seulement)

### Edge Functions ne déploient pas

**Problème :** "Failed to deploy function X"

**Solutions :**
1. Vérifiez que `SUPABASE_ACCESS_TOKEN` a permission "Functions Deploy"
2. Vérifiez le quota d'edge functions du projet (Supabase Dashboard)
3. Redéployez individuellement :
   ```bash
   supabase functions deploy score-prospect-signals --project-ref <ref> --no-verify-jwt
   ```

---

## Améliorations Recommandées

### Post-Déploiement

- [ ] Activez **2FA** (Settings → Authentication → 2FA)
- [ ] Configurez un **domaine personnalisé** (Vercel/Netlify settings)
- [ ] Mettez en place **monitoring** (Sentry, Logrocket, etc.)
- [ ] Sauvegarde **automatique** (Supabase backups)
- [ ] CDN **image** (Cloudinary, AWS S3, etc.)

### Optionnel

- Extension Chrome pour LinkedIn scraping (voir [ARCHITECTURE.md](ARCHITECTURE.md))
- Webhooks sortants (pour CRM externe)
- Notifications email (via Resend, SendGrid)

---

## Ressources

- **[README.md](../README.md)** — Quickstart rapide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Pipeline, edge functions
- **[data-model.md](data-model.md)** — Schéma DB, RLS
- **[providers.md](providers.md)** — Intégrer nouveaux fournisseurs
- **Supabase Docs** : https://supabase.com/docs
  - [Edge Functions](https://supabase.com/docs/guides/functions)
  - [Database](https://supabase.com/docs/guides/database)
  - [Auth](https://supabase.com/docs/guides/auth)
- **Vite Docs** : https://vitejs.dev
- **React Docs** : https://react.dev

---

## Support

- **Bug ou Question :** Ouvrez une [Issue](https://github.com/Jayteam2025/jay-reach/issues)
- **Sécurité :** [SECURITY.md](../SECURITY.md)
- **Contribution :** [CONTRIBUTING.md](../CONTRIBUTING.md)

Bonne prospection ! 🚀

> **Français** | [English](providers.en.md)

# Providers — Intégrer des Fournisseurs Externes

Jay Reach est construit sur un modèle **BDD-first, BYOK** (Bring Your Own Keys) pour les clés API : elles sont **saisies dans l'interface**, stockées **chiffrées en base de données**, et **jamais en `.env`** en plain-text.

---

## Vue d'ensemble

### Catégories de Providers

| Catégorie | Rôle | Exemples |
|-----------|------|----------|
| **LLM** | Évalue les signaux, score les prospects | Anthropic Claude (défaut), OpenAI-compatible (Mistral, etc.) |
| **Source** | Récupère les offres d'emploi | Adzuna, France Travail |
| **Enrichisseur** | Enrichit contacts avec emails, LinkedIn, données | FullEnrich |
| **Validation Email** | Vérifie délivrabilité des emails | Bouncer, Reoon (optionnel) |
| **Outreach** | Envoie campagnes froides | Smartlead |
| **Démo** | Exploration sans clés (stubs internes) | Demo (gratuit, intégré) |

### Modèle de Stockage (Chiffré)

**Schéma :**
- Table `workspace_provider_credentials` — stocke clés chiffrées par workspace
- Colonne `encrypted_secret` — chiffrée AES-GCM avec secret Supabase `TOKEN_ENCRYPTION_KEY`
- Module `_shared/token-encryption.ts` — chiffre/déchiffre au runtime

**Saisie UI :**
- Onglet **Config** → **Providers**
- Un formulaire par fournisseur
- Test de connexion intégré : `test-provider-connection` (fonction edge)

**Fallback en Développement :**
- Si clé non saisie en BDD, fallback sur variables d'env locales (voir `.env.example` par provider)
- En prod OSS, chaque utilisateur apporte ses propres clés (modèle BYOK)

---

## LLM (Modèles de Langage)

### Anthropic Claude (Par défaut)

Claude score les signaux, détermine si une offre d'emploi correspond à votre stratégie de prospection.

**Modèles supportés :**
- `claude-3-5-sonnet-20241022` (par défaut) — balance coût/qualité, recommandé
- `claude-3-5-haiku-20241022` — rapide, bon pour les tâches légères
- `claude-3-opus-20250219` — puissant mais coûteux, pour les analyses complexes

**Obtenir votre clé :**
1. Allez sur https://console.anthropic.com/account/api-keys
2. Cliquez « Create Key »
3. Copiez la clé

**Configuration :**
1. Onglet **Config** → **Providers** → **LLM**
2. Sélectionnez **Anthropic (Claude)**
3. Collez votre clé API
4. Testez la connexion via le bouton **Test**

**Coûts :** Environ $0.003 par scoring (voir https://www.anthropic.com/pricing)

### OpenAI-Compatible (Mistral, OpenAI, autres)

Support des API compatibles OpenAI (Mistral, OpenAI, etc.) avec endpoint custom.

**Paramètres requis :**
- **Base URL** : endpoint API (ex: `https://api.mistral.ai/v1` pour Mistral)
- **Clé API** : token d'authentification
- **Modèle rapide** : pour tâches légers (enrichissement initial)
- **Modèle avancé** : pour scoring (analyses complexes)

**Configuration :**
1. Onglet **Config** → **Providers** → **LLM**
2. Sélectionnez **OpenAI-compatible**
3. Remplissez :
   - Base URL (ex: `https://api.mistral.ai/v1`)
   - Clé API
   - Modèle rapide (ex: `mistral-small`)
   - Modèle avancé (ex: `mistral-medium`)
4. Testez la connexion

**Exemples :**

| Provider | Base URL | Clé | Modèles |
|----------|----------|-----|---------|
| **Mistral** | `https://api.mistral.ai/v1` | https://console.mistral.ai/api-keys/ | `mistral-small`, `mistral-medium` |
| **OpenAI** | `https://api.openai.com/v1` | https://platform.openai.com/api-keys | `gpt-4o-mini`, `gpt-4o` |

---

## Sources d'Offres (Scraping)

Jay Reach récupère les offres d'emploi de deux sources principales. Vous **devez activer au moins une source** pour scraper les offres.

### Adzuna

Agrégateur d'offres d'emploi français et internationaux (API REST structurée, qualité haute).

**Obtenir vos identifiants :**
1. Allez sur https://developer.adzuna.com
2. Inscrivez-vous ou connectez-vous
3. Créez une application (dashboard → API Accounts)
4. Notez **App ID** et **App Key**

**Configuration :**
1. Onglet **Config** → **Providers** → **Sources d'offres**
2. Sélectionnez **Adzuna**
3. Remplissez :
   - App ID
   - App Key
4. Testez la connexion

**Couverture :** France, UK, Allemagne, Suisse et 25+ pays
**Coûts :** Gratuit (5000 requêtes/mois par défaut, extensible)
**Actualisée :** Quotidienne

### France Travail (ex-Pôle Emploi)

Service officiel français des offres d'emploi (API GraphQL, données publiques).

**Obtenir vos identifiants :**
1. Allez sur https://francetravail.io
2. Demandez l'accès API (section « Partenaires »)
3. Validez les conditions
4. Vous recevrez **Client ID** et **Client Secret** par email

**Configuration :**
1. Onglet **Config** → **Providers** → **Sources d'offres**
2. Sélectionnez **France Travail**
3. Remplissez :
   - Client ID
   - Client Secret
4. Testez la connexion

**Couverture :** France uniquement (données du service public)
**Coûts :** Gratuit
**Actualisée :** Quotidienne

---

## Enrichisseur (Contacts & Emails)

### FullEnrich

Enrichit prospects avec **emails déductibles**, LinkedIn URLs, données d'entreprise.

**À quoi ça sert :**
- Trouver l'email professionnel d'un prospect (exemple : jean.dupont → jean.dupont@acme.fr)
- Récupérer le profil LinkedIn
- Compléter domaine, secteur, taille entreprise

**Obtenir votre clé :**
1. Allez sur https://app.fullenrich.com
2. Inscrivez-vous ou connectez-vous
3. Onglet **Settings** → **API** → copier votre **API Key**

**Configuration :**
1. Onglet **Config** → **Providers** → **Enrichisseur**
2. Sélectionnez **FullEnrich**
3. Collez votre clé API
4. Testez la connexion

**Coûts :** $0.01 par email déductible, $0.02 par enrichissement personne
**Limite quota :** Consultable dans Settings → Billing de FullEnrich

---

## Validation Email (Délivrabilité)

Avant d'envoyer une campagne, validez que les emails sont **actifs** (typos, disposable, role addresses, etc.).

### Bouncer (Primaire)

Vérifie la délivrabilité avec **apprentissage automatique** des bounce_rate par domaine.

**À quoi ça sert :**
- Détecter typos (google.com vs googel.com)
- Exclure role addresses (info@, contact@, noreply@)
- Identifier emails disposables/temporaires
- Prédire bounces avant envoi (sauve crédits Smartlead)

**Obtenir votre clé :**
1. Allez sur https://usebouncer.com
2. Inscrivez-vous → Dashboard
3. Onglet **Settings** → **API** → copier votre clé

**Configuration :**
1. Onglet **Config** → **Providers** → **Validation Email**
2. Sélectionnez **Bouncer**
3. Collez votre clé API
4. Testez la connexion

**Statuts retournés :** `valid` | `invalid` | `risky` | `disposable` | `role` | `unknown`

**Coûts :** $0.005 par email vérifié

**Automatisation :**
- Vérification automatique lors de l'enrichissement
- Cron batch quotidien (07h, 13h UTC) pour re-vérifier les emails en cache
- Apprentissage automatique (04h UTC) : met à jour `domain_email_patterns.bounce_rate`

### Reoon (Optionnel — Arbitrage)

Deuxième opinion pour les cas **unknown** ou **risky** de Bouncer.

**À quoi ça sert :**
- Arbitrer les emails incertains
- Améliorer le taux de délivrabilité quand Bouncer hésite
- Prise de décision en cas de doute

**Obtenir votre clé :**
1. Allez sur https://reoon.com
2. Inscrivez-vous
3. Onglet **API** → copier votre clé

**Configuration :**
1. Onglet **Config** → **Providers** → **Validation Email**
2. Sélectionnez **Reoon** (optionnel)
3. Collez votre clé API
4. Testez la connexion

**Statuts retournés :** `safe` | `risky` | `invalid`

**Recommandation :** Utilisez Bouncer seul pour débuter, ajoutez Reoon si vous gérez gros volume.

---

## Outreach (Envoi de Campagnes)

Smartlead est votre seul canal d'envoi. C'est une plateforme cold email avec warm-up, suivi de réponses, et webhooks intégrés.

### Smartlead

**À quoi ça sert :**
- Envoyer vos campaigns froides
- Warm-up IP automatique (réputation)
- Suivi opens, clics, réponses
- Webhook en temps réel de statuts
- Gestion des bounce/unsubscribe

**Obtenir votre clé :**
1. Allez sur https://smartlead.ai
2. Connectez-vous ou créez un compte
3. Onglet **Settings** → **API** → copier votre clé

**Configuration :**
1. Onglet **Config** → **Providers** → **Outreach**
2. Sélectionnez **Smartlead**
3. Collez votre clé API
4. Testez la connexion

**Mappage Personas → Campagnes :**

Chaque **persona** (RH, Director, Field Sales, etc.) doit être lié à une **campagne Smartlead**. Configurez ce mappage dans l'onglet **Config** → **Campagnes** :

| Persona | Campagne Smartlead | Template Email |
|---------|-------------------|----------------|
| RH | `hr-2026-06` | Recrutement |
| Director | `director-2026-06` | Expansion commerciale |
| Field Sales | `sales-2026-06` | Partnership |

> Chaque prospect est affecté à une campagne selon son rôle détecté. Les emails envoyés conservent un unique objet/signature par campagne.

**Statuts de suivi :** `sent | bounced | opened | replied | unsubscribed`

**Coûts :** Basés sur le nombre d'emails envoyés (consultez https://smartlead.ai/pricing)

---

> **ℹ️ Note sur Resend**
>
> **Resend** est utilisé **uniquement pour les notifications internes** (recap hebdomadaire, alertes crédits FullEnrich) via la clé secret Edge Function `RESEND_API_KEY`. **Ce n'est PAS un provider d'outreach** et ne se configure pas dans l'interface Providers. L'envoi de campagnes se fait exclusivement via Smartlead.

---

## Mode Démo (sans clés)

Pour explorer Jay Reach sans configurer de clés, activez le **mode Démo**. Il génère des données réalistes (prospects, emails, verdicts Bouncer) et fonctionne entièrement hors-ligne.

**Cas d'usage :**
- Première prise en main (30 min)
- Démonstration commerciale
- Test local sans crédits

**Activation :**
1. Onglet **Config** → **Providers** → **LLM**
2. Sélectionnez **Demo**
3. Pas de clé à remplir
4. Testez — vous pouvez scraper, scorer, enrichir avec des données fake

> Le mode Démo retourne toujours des décisions cohérentes (même prospect = même verdict), idéal pour tester le workflow entier.

---

## Test de Connexion

Chaque provider dispose d'un bouton **Test** dans sa fiche de configuration. Cliquez-le pour vérifier :
- Clé valide et non expirée
- Permissions correctes
- Connectivity API réseau
- Limite quota non atteinte

En cas d'erreur, consultez la section **Troubleshooting** ci-dessous.

---

## Troubleshooting

### "API key invalid"

**Possible causes :**
- Clé expirée
- Clé copiée partiellement
- Mauvaise clé pour le service (Adzuna app_id ≠ Bouncer api_key)
- Permissions insuffisantes (certains services limitent par IP)

**Solution :**
1. Vérifiez le dashboard du provider (ex: https://usebouncer.com/dashboard → Settings → API)
2. Générateur nouvelle clé si nécessaire
3. Collez la clé complète (pas de copies partielles)
4. Testez à nouveau

### "Provider not found"

- Vérifiez que le provider est dans la liste (voir Overview ci-dessus)
- Rechargez la page : `Ctrl+R` ou `Cmd+R`
- Clair du cache : `Ctrl+Shift+Delete`

### "Quota exceeded / Rate limit"

- Consultez le dashboard du provider (crédits restants)
- Upgrade votre plan chez le provider si nécessaire
- Pour Adzuna : limite par défaut 5000/mois, demandez une augmentation via developer.adzuna.com
- Pour FullEnrich : limite par forfait, consultez Settings → Billing

### Je veux tester sans clés (mode local)

Activez le **mode Démo** (voir section ci-dessus). Zéro credentials requises.

---

## Ressources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Pipeline, edge functions
- [data-model.md](data-model.md) — Stockage chiffré `workspace_provider_credentials`
- Documentation officielle des API :
  - Anthropic: https://docs.anthropic.com
  - FullEnrich: https://docs.fullenrich.com
  - Bouncer: https://usebouncer.com/docs
  - Smartlead: https://docs.smartlead.ai
  - Adzuna: https://developer.adzuna.com/documentation
  - France Travail: https://francetravail.io/developer

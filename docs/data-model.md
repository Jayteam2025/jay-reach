> **Français** | [English](data-model.en.md)

# Modèle de Données — Jay Reach OSS

## Vue d'ensemble

Jay Reach est **multi-tenant workspace-based**. Chaque organisation (workspace) exploite ses propres prospects, déclencheurs (signal triggers), personas et configurations. Tous les accès sont protégés par **Row-Level Security (RLS)** Postgres via la fonction `user_workspaces(min_role)`, qui valide l'appartenance de l'utilisateur au workspace et son rôle.

**Tonalité générique** : zéro trace Jay-specific. Prospection B2B configurable, sourcing → scoring → enrichissement → validation email → push Smartlead (ou tout outreach générique).

---

## Architecture Multi-tenant

### Socle d'authentification & tenancy

#### `auth.users` (Supabase Auth)
- Gérée par Supabase — email + password hash
- UUID primaire
- Authentification JWT

#### `profiles`
Profil utilisateur (extension `auth.users`).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | Référence `auth.users(id)`, cascade DELETE |
| `email` | text | Email utilisateur |
| `first_name` | text | Prénom |
| `last_name` | text | Nom |
| `role` | text | `admin` ou `member` (profile-level, non workspace) |
| `current_plan` | text | `oss` (par défaut), ou plan commercial |
| `created_at` | timestamptz | Timestamp création |

**RLS** : `self read` (SELECT si `id = auth.uid()`) + `self update` (UPDATE/CHECK si `id = auth.uid()`).

#### `workspaces`
Organisation/instance multi-tenant (SaaS tenant).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `name` | text | Nom du workspace (ex: "Mon workspace") |
| `slug` | text | Slug unique (ex: "ws-abc12345") |
| `settings` | jsonb | Configuration générale (branding, seuils LLM, modèles) |
| `created_by` | uuid (FK) | Référence `auth.users(id)` |
| `is_active` | bool | `true` par défaut |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : `members read ws` (SELECT si workspace dans `user_workspaces('viewer')`) + `members update ws` (UPDATE/CHECK si workspace dans `user_workspaces('admin')`).

#### `workspace_members`
Appartenance user → workspace + rôle.

| Colonne | Type | Description |
|---------|------|-------------|
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `user_id` | uuid (FK) | Référence `auth.users(id)`, cascade DELETE |
| `role` | text | `owner`, `admin`, `member`, ou `viewer` |
| `invited_by` | uuid (FK) | Qui a invité l'utilisateur (ref `auth.users(id)`) |
| `joined_at` | timestamptz | Date d'adhésion au workspace |
| **PK** | | `(workspace_id, user_id)` |

**RLS** : `members read wm` (SELECT si workspace dans `user_workspaces('viewer')`).

#### Fonction RLS backbone : `user_workspaces(min_role DEFAULT 'viewer')`

```sql
create or replace function public.user_workspaces(min_role text default 'viewer')
returns setof uuid language sql stable security definer set search_path = 'public' as $$
  select workspace_id from public.workspace_members
  where user_id = auth.uid()
    and case min_role
      when 'viewer' then role in ('viewer','member','admin','owner')
      when 'member' then role in ('member','admin','owner')
      when 'admin'  then role in ('admin','owner')
      when 'owner'  then role = 'owner'
      else false end;
$$;
```

**Utilisation** : toutes les RLS policies workspace-based l'utilisent. Retourne un `SETOF uuid` (list des workspace_ids accessibles). **SECURITY DEFINER** pour bypassez la RLS de `workspace_members` lui-même (évite les boucles infinies).

#### Trigger de bootstrap : `handle_new_user()`

Trigger déclenché à chaque `INSERT` sur `auth.users` :
1. Crée un profil `admin` dans `profiles`
2. Crée un workspace par défaut (`'Mon workspace'`)
3. Ajoute l'utilisateur comme `owner` du workspace dans `workspace_members`

**Tous les users signup deviennent admin et reçoivent leur propre workspace OSS.** Pas de domaine whitelist.

---

### Signaux & Prospection

#### `prospect_profiles`
Identité enrichie d'une personne prospectée (contact).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `first_name` | text | Prénom (ex: "Jean") |
| `last_name` | text | Nom (ex: "Dupont") |
| `email` | text | Email principal |
| `job_title` | text | Titre de poste |
| `company_name` | text | Nom société |
| `company_siren` | text | SIREN INSEE (unique) |
| `company_size` | text | Taille (ex: "50-250", "250+") |
| `company_sector` | text | Secteur/NAF |
| `company_city` | text | Ville siège |
| `company_group_id` | uuid | Groupement logique des contacts de même société |
| `linkedin_url` | text | URL LinkedIn |
| `status` | text | `new`, `qualified`, `in_sequence`, `replied`, `meeting_booked`, `converted`, `lost` |
| `persona_id` | uuid (FK) | Référence `icp_personas(id)`, persona cible pour ce contact |
| `source_signal_id` | uuid (FK) | Signal ayant déclenché la détection (ref `prospect_signals(id)`) |
| `email_source` | text | Origine email : `deduced`, `fullenrich`, `crm`, `manual`, `imported`, `unknown` |
| `deliverability_status` | text | Verdict validateur : `valid`, `invalid`, `risky`, `disposable`, `role`, `unknown` |
| `deliverability_reason` | text | Raison du verdict (ex: "mailbox does not exist") |
| `deliverability_checked_at` | timestamptz | Quand le verdict a été obtenu |
| `deliverability_provider` | text | Validateur utilisé : `bouncer`, `reoon`, `demo` |
| `bouncer_status` | text | **Legacy** : remplacé par `deliverability_status` |
| `bouncer_checked_at` | timestamptz | **Legacy** |
| `smartlead_push_decision` | text | Décision gate : `push`, `skip` |
| `smartlead_push_reason` | text | Raison du gate (ex: "bouncer_invalid", "pattern_unknown") |
| `more_available_counts` | jsonb | Compteurs FullEnrich (pour pagination contacts d'une société) |
| `deleted_at` | timestamptz | Soft delete (NULL = actif) |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : `members read` (SELECT si workspace dans `user_workspaces('viewer')`) / `members insert/update` (si workspace dans `user_workspaces('member')`) / `admins delete` (si workspace dans `user_workspaces('admin')`).

**Indices clés** : `workspace_id`, `persona_id`, `deliverability_status`, `status`, `email_source`, `deleted_at`.

#### `prospect_signals`
Signaux bruts détectés (annonces d'emploi, activité LinkedIn, etc.).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)` |
| `signal_type` | text | `job_posting`, `linkedin_activity`, `google_alert`, etc. |
| `source` | text | Source du signal (ex: "Adzuna", "France Travail") |
| `source_url` | text | URL source |
| `raw_content` | text | Contenu brut du signal (texte annonce, etc.) |
| `extracted_data` | jsonb | Données structurées extraites (JSON job details) |
| `company_name` | text | Nom société détecté du signal |
| `matched_prospect_id` | uuid (FK) | Contact appairé (ref `prospect_profiles(id)`) |
| `status` | text | `raw`, `matched`, `dismissed` |
| `is_archived` | bool | `false` par défaut ; archivé si hors top-15 après scoring |
| `detected_at` | timestamptz | Quand le signal a été trouvé |
| `created_at` | timestamptz | Timestamp création |

**RLS** : workspace-based (même pattern que `prospect_profiles`).

**Indices clés** : `workspace_id`, `status`, `detected_at`, `source`.

#### `prospect_imports`
Batches d'import CSV/manuels.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)` |
| `user_id` | uuid (FK) | Qui a lancé l'import |
| `import_name` | text | Nom du batch (ex: "Import Q2 2026") |
| `import_type` | text | `csv`, `manual`, `api` |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `total_rows` | int | Nombre de lignes en entrée |
| `successful_rows` | int | Nombre de contacts créés |
| `mapping` | jsonb | Colonnes mappées (CSV → prospect_profiles) |
| `error_log` | jsonb | Erreurs détaillées par ligne |
| `created_at` | timestamptz | Timestamp création |
| `completed_at` | timestamptz | Quand l'import a terminé |

**RLS** : `members` (lecture du workspace) / `members insert/update` (sa propre ligne) / `admin delete`.

---

### Déclencheurs & Personas

#### `signal_triggers`
Comment trouver les bonnes sociétés (filtres de scrape/sourcing). Distinct des personas (qui contacter).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `slug` | text | Identifiant unique par workspace (ex: "recrutement-commerciaux") |
| `label` | text | Libellé lisible (ex: "Recrutement Commerciaux") |
| `description` | text | Description détaillée |
| `icon` | text | Icône (emoji ou class) |
| `search_keywords` | text[] | Mots-clés de scrape (ex: ["commercial", "sales director"]) |
| `exclude_keywords` | text[] | Exclusions (ex: ["freelance", "agence"]) |
| `source_types` | text[] | Sources activées : `adzuna`, `france_travail`, `brave`, `linkedin_jobs`, etc. |
| `company_size_min` | int | Taille min (0-10, 11-50, etc.) |
| `company_size_max` | int | Taille max |
| `industry_filters` | text[] | Secteurs cibles (ex: ["Tech", "Finance"]) |
| `geo_filters` | jsonb | Filtres géographiques (pays, régions) |
| `signal_scoring_prompt` | text | Prompt LLM pour qualifier le signal (la boite est intéressante ?) |
| `signal_match_threshold` | int | Seuil de confiance (0-100) pour garder le signal |
| `elimination_rules` | jsonb | Règles d'élimination supplémentaires |
| `is_active` | bool | `true` par défaut |
| `is_default` | bool | Un seul `true` par workspace |
| `created_by` | uuid (FK) | Ref `auth.users(id)` |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : `members read` (viewer) / `admins insert/update/delete`.

**Indices clés** : `workspace_id, is_active`, `workspace_id, slug`, `workspace_id, is_default`.

#### `icp_personas`
Qui contacter dans les sociétés trouvées par les signal_triggers.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `slug` | text | Identifiant unique (ex: "drh-grand-groupe") |
| `name` | text | Libellé (ex: "Directeur RH") |
| `description` | text | Description détaillée du persona |
| `job_title_keywords` | text[] | Mots-clés titres de poste (ex: ["Director", "VP", "Head"]) |
| `seniority_levels` | text[] | Niveaux hiérarchiques (ex: ["c_level", "director", "manager"]) |
| `department_patterns` | text[] | Rôles fonctionnels (ex: ["Sales", "HR", "Operations"]) |
| `exclude_titles` | text[] | Titres à exclure |
| `persona_scoring_prompt` | text | Prompt LLM pour évaluer si contact = persona (0-100) |
| `persona_match_threshold` | int | Score min pour retenir le contact (0-100) |
| `is_active` | bool | `true` par défaut |
| `is_default` | bool | Un seul `true` par workspace |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (viewer read, admin insert/update/delete).

**Indices clés** : `workspace_id, is_active`, `workspace_id, slug`.

#### `prospect_message_templates`
Templates de messages prospection (email, LinkedIn, courrier, DM social).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)` |
| `persona_id` | uuid (FK) | Référence `icp_personas(id)` (peut être NULL pour templates legacy) |
| `channel` | text | `email`, `linkedin`, `postal_letter`, `social_dm` |
| `subject_variants` | text[] | Variantes du sujet (email) |
| `opener_variants` | text[] | Ouvertures du message |
| `body` | text | Corps du message (template avec `{{variables}}`) |
| `icebreaker_template` | text | Crochet initial |
| `is_active` | bool | `true` par défaut |
| `version` | int | Versioning (auto-incrémenté sur UPDATE) |
| `updated_at` | timestamptz | Timestamp mise à jour |
| `updated_by` | uuid (FK) | Qui a modifié |

**RLS** : workspace-based (viewer read, admin insert/update/delete).

**Unique** : `(workspace_id, persona_id, channel)` (1 template par persona et canal).

---

### Fournisseurs & Configurations

#### `workspace_providers`
Enregistrement des fournisseurs actifs (Smartlead, FullEnrich, Bouncer, etc.).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `category` | text | `outreach` (Smartlead), `validator` (Bouncer), `enricher` (FullEnrich) |
| `provider_type` | text | Type du provider (ex: "smartlead", "bouncer", "fullenrich") |
| `channel` | text | Canal (outreach uniquement) : `email`, `linkedin`, NULL pour validator/enricher |
| `is_active` | bool | `true` si actif |
| `config` | jsonb | Configuration (schema spécifique au provider) |
| `credential_last4` | text | Derniers 4 caractères de la clé (affichage UI) |
| `credential_set_at` | timestamptz | Quand la clé a été rentrée |
| `last_test_status` | text | Résultat du dernier test (`success`, `failed`) |
| `last_test_at` | timestamptz | Quand le dernier test a eu lieu |
| `last_test_detail` | text | Détail du test (message d'erreur si failed) |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (viewer read, admin insert/update/delete).

**Unique** : `(workspace_id, category, channel, is_active)` (1 seul provider actif par catégorie/canal).

#### `workspace_provider_credentials`
Stockage chiffré des clés API (AES-256-GCM via `token-encryption.ts`).

| Colonne | Type | Description |
|---------|------|-------------|
| `provider_id` | uuid (PK, FK) | Référence `workspace_providers(id)`, cascade DELETE |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `encrypted_key` | text | Base64 (IV + ciphertext + auth tag) |
| `last4` | text | Derniers 4 chars (affichage UI safe) |
| `set_by` | uuid (FK) | Qui a rentrée la clé |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : RLS activée mais **sans policy = service_role uniquement** (les clés ne doivent JAMAIS transiter par PostgREST client).

#### `workspace_brand`
Branding et configuration par workspace.

| Colonne | Type | Description |
|---------|------|-------------|
| `workspace_id` | uuid (PK, FK) | Référence `workspaces(id)`, 1-1 avec workspaces |
| `brand_name` | text | Nom de la marque |
| `signature` | text | Signature email |
| `hero_image_url` | text | Image en-tête |
| `founder_name` | text | Nom du fondateur/auteur (substitue `{{founder_name}}` dans les prompts) |
| `product_pitch` | text | Court pitch du produit (substitue `{{product_pitch}}`) |
| `app_url` | text | URL de l'app (pour liens dans emails recap) |
| `notification_recipients` | text[] | Emails destinataires des notifications (liste vide = pas d'envoi) |
| `attachments` | jsonb | Pièces jointes (CV inline, etc.) : `[{persona_id?, channel?, type, url, alt?}, ...]` |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (viewer read, admin insert/update/delete).

---

### Campagnes & Messages

#### `prospect_batches`
Campagne de sourcing (un batch de prospects à traiter ensemble).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `name` | text | Nom camp (ex: "Sourcing RH Q2 2026") |
| `status` | text | `draft`, `sourcing`, `scoring`, `enriching`, `ready`, `sent` |
| `trigger_id` | uuid (FK) | Signal trigger utilisé (ref `signal_triggers(id)`) |
| `persona_id` | uuid (FK) | Persona cible (ref `icp_personas(id)`) |
| `total_prospects` | int | Nombre de prospects dans le batch |
| `prospects_sourced` | int | Trouvés |
| `prospects_scored` | int | Qualifiés |
| `prospects_enriched` | int | Enrichis |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (member read/insert/update, admin delete).

**Indices clés** : `workspace_id, status`, `workspace_id, persona_id`.

#### `prospect_messages`
Messages prospection générés pour chaque prospect.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)` |
| `prospect_id` | uuid (FK) | Référence `prospect_profiles(id)`, cascade DELETE |
| `batch_id` | uuid (FK) | Batch d'appartenance (ref `prospect_batches(id)`) |
| `persona_id` | uuid (FK) | Persona visé (ref `icp_personas(id)`) |
| `channel` | text | `email`, `linkedin`, `postal_letter`, `social_dm` |
| `subject` | text | Sujet (email) |
| `body` | text | Corps du message |
| `icebreaker` | text | Crochet initial |
| `status` | text | `draft`, `approved`, `sent`, `replied`, `bounced` |
| `template_id` | uuid (FK) | Template utilisé (ref `prospect_message_templates(id)`) |
| `template_version` | int | Version du template à la génération |
| `scheduled_at` | timestamptz | Date d'envoi programmée |
| `sent_at` | timestamptz | Date envoi réel |
| `replied_at` | timestamptz | Date première réponse |
| `llm_model` | text | Modèle LLM utilisé (ex: "mistral-medium-3-5") |
| `llm_prompt_hash` | text | Hash du prompt (traçabilité) |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based.

**Indices clés** : `workspace_id, prospect_id`, `workspace_id, status`, `workspace_id, channel`.

#### `prospect_actions`
Actions de suivi (sent, opened, replied, clicked, downloaded).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)` |
| `prospect_id` | uuid (FK) | Référence `prospect_profiles(id)`, cascade DELETE |
| `action_type` | text | `copy`, `open`, `sent`, `download` |
| `channel` | text | `email`, `linkedin`, `instagram`, `tiktok`, `letter`, `postal_letter`, `social_dm` |
| `metadata` | jsonb | Contexte (campaign_id, timestamp, provider, etc.) |
| `created_at` | timestamptz | Timestamp action |

**RLS** : workspace-based (member insert, admin delete).

---

### Enrichissement & Validation

#### `prospect_enrichment_jobs`
Queue d'enrichissement FullEnrich par prospect.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `user_id` | uuid (FK) | Qui a lancé l'enrichissement (ref `auth.users(id)`) |
| `batch_id` | uuid (FK) | Batch associé (ref `prospect_batches(id)`, peut être NULL) |
| `prospect_id` | uuid (FK) | Contact principal (ref `prospect_profiles(id)`) |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `fullenrich_request_id` | text | ID API FullEnrich |
| `result` | jsonb | Réponse FullEnrich (contacts trouvés) |
| `error` | text | Message d'erreur si failed |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |
| `completed_at` | timestamptz | Quand le job a terminé |

**RLS** : workspace-based (member insert/update/read own jobs, admin read all).

#### `prospect_enrichment_job_items`
Contacts trouvés par un job d'enrichissement (N contacts par job).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `job_id` | uuid (FK) | Référence `prospect_enrichment_jobs(id)`, cascade DELETE |
| `prospect_id` | uuid (FK) | Contact trouvé (ref `prospect_profiles(id)`) |
| `email` | text | Email trouvé |
| `job_title` | text | Titre de poste |
| `status` | text | `pending`, `processing`, `completed`, `failed` |
| `error` | text | Erreur si failed |
| `created_at` | timestamptz | Timestamp création |
| `completed_at` | timestamptz | Timestamp completion |

**RLS** : access via le job parent (même user/admin).

#### `bouncer_jobs`
Tracking des batchs de vérification email Bouncer.

| Colonne | Type | Description |
|---------|------|-------------|
| `job_id` | text (PK) | ID fourni par Bouncer |
| `profile_ids` | uuid[] | Contacts vérifiés dans ce batch |
| `sent_at` | timestamptz | Quand le batch a été envoyé |
| `received_at` | timestamptz | Quand le webhook Bouncer a répondu |
| `status` | text | `pending`, `completed`, `failed`, `timeout` |
| `webhook_payload` | jsonb | Réponse webhook Bouncer |

**RLS** : service_role uniquement (pas de policy = pas d'accès client).

#### `pattern_audit_events`
Audit des patterns d'email et apprentissage rebond.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `prospect_id` | uuid (FK) | Référence `prospect_profiles(id)`, cascade DELETE |
| `email` | text | Email testé |
| `domain` | text | Domaine extracted |
| `email_source` | text | Provenance email : `deduced`, `fullenrich`, `crm`, `manual`, `unknown` |
| `pattern_id` | text | ID du pattern d'email utilisé |
| `pattern_confidence` | numeric | Confiance du pattern (0-1) |
| `fullenrich_status` | text | Statut FullEnrich |
| `event_type` | text | `generated`, `bouncer_verdict`, `sent`, `bounced`, `replied`, `opened` |
| `event_value` | text | Valeur event (ex: "invalid" pour bouncer_verdict) |
| `occurred_at` | timestamptz | Timestamp event |

**RLS** : service_role (bounce-learning backend).

**Indices clés** : `prospect_id`, `domain, pattern_id`, `event_type`.

#### `smartlead_campaigns`
Mapping persona → campagne Smartlead.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `persona_id` | uuid (FK) | Référence `icp_personas(id)`, cascade DELETE |
| `campaign_id` | text | ID Smartlead (string) |
| `campaign_name` | text | Nom Smartlead |
| `enabled` | bool | `true` par défaut |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (viewer read, admin insert/update/delete).

**Unique** : `(workspace_id, persona_id)` (1 campagne Smartlead par persona).

#### `smartlead_events`
Webhook brut des événements Smartlead (sent, opened, replied, bounced, clicked).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `prospect_id` | uuid (FK) | Contact appairé (ref `prospect_profiles(id)`, peut être NULL) |
| `lead_email` | text | Email du lead (Smartlead) |
| `campaign_id` | bigint | ID campagne Smartlead |
| `event_type` | text | Event type (sent, opened, replied, bounced, clicked) |
| `subject` | text | Sujet du message |
| `message` | text | Contenu |
| `email_account` | text | Compte email utilisé |
| `raw_payload` | jsonb | Payload webhook complet |
| `created_at` | timestamptz | Timestamp reçu |

**RLS** : service_role uniquement (webhook Smartlead).

**Indices clés** : `prospect_id`, `event_type`, `created_at DESC`.

---

### Détection CRM & Utilitaires

#### `prospect_crm_detections`
Détection des CRM utilisés par les sociétés (signaux d'adoption CRM).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `company_group_id` | uuid | Groupement logique société |
| `prospect_id` | uuid (FK) | Contact source (ref `prospect_profiles(id)`, peut être NULL) |
| `crm_type` | text | CRM détecté : `salesforce`, `hubspot`, `pipedrive`, `zoho`, etc. |
| `confidence` | numeric | Confiance de la détection (0-1) |
| `signals` | jsonb | Signaux détectés (ex: `{email_domain: "company.salesforce.com"}`) |
| `attempts` | int | Nombre de tentatives de détection |
| `detected_at` | timestamptz | Quand la détection s'est produite |
| `created_at` | timestamptz | Timestamp création |
| `updated_at` | timestamptz | Timestamp mise à jour |

**RLS** : workspace-based (member read/insert/update, admin delete).

#### `recruitment_agencies_blacklist`
Agences RH à exclure du sourcing (Heidrick, Korn Ferry, etc).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `workspace_id` | uuid (FK) | Référence `workspaces(id)`, cascade DELETE |
| `agency_name` | text | Nom agence (ex: "Heidrick & Struggles") |
| `domain_patterns` | text[] | Patterns de domaine (ex: `["recruiter.fr", "korn*.com"]`) |
| `created_at` | timestamptz | Timestamp création |

**RLS** : workspace-based.

---

### Utilitaires Backend

#### `enrichment_cache`
Cache des résultats API coûteux (résolution entreprise, etc.).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `cache_type` | text | Type de cache (ex: "company_lookup") |
| `cache_key` | text | Clé de lookup (ex: SIREN) |
| `data` | jsonb | Valeur en cache |
| `created_at` | timestamptz | Timestamp création |
| `expires_at` | timestamptz | Expiration TTL |

**Unique** : `(cache_type, cache_key)`.

**RLS** : service_role uniquement.

#### `pending_fullenrich_bulks`
Cache webhook FullEnrich (anti rate-limit).

| Colonne | Type | Description |
|---------|------|-------------|
| `enrichment_id` | text (PK) | ID FullEnrich |
| `webhook_payload` | jsonb | Payload webhook reçu |
| `received_at` | timestamptz | Quand la réponse a été reçue |
| `created_at` | timestamptz | Timestamp création |

**RLS** : service_role uniquement.

#### `api_rate_limits`
Rate limiting des edge functions (imports, webhooks publics).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `identifier` | text | IP ou user_id |
| `identifier_type` | text | `ip`, `user` |
| `endpoint_category` | text | `oauth`, `webhook`, `admin`, `api`, `public` |
| `request_count` | int | Compteur req |
| `window_start` | timestamptz | Début de la fenêtre |
| `created_at` | timestamptz | Timestamp création |

**RLS** : admin read, service_role write.

#### `edge_function_logs`
Logs applicatifs des edge functions.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid (FK) | Qui a déclenché (ref `profiles(id)`) |
| `function_name` | text | Nom fonction |
| `status` | text | `success`, `error`, `warning` |
| `message` | text | Message log |
| `metadata` | jsonb | Contexte additionnel |
| `created_at` | timestamptz | Timestamp log |

**RLS** : users read own logs, admins read all.

#### `validation_errors`
Logs des erreurs de validation Zod (mode warn, non bloquant).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `function_name` | text | Fonction qui a loggé |
| `errors` | jsonb | Erreurs Zod structurées |
| `received_data` | text | Données problématiques |
| `user_id` | uuid (FK) | User_id concerné |
| `created_at` | timestamptz | Timestamp log |

**RLS** : admin read.


---

## Patterns & Bonnes Pratiques

### RLS Backbone : `user_workspaces(min_role)`

Toutes les tables prospect-related utilisent ce pattern uniforme :

```sql
alter table <table_name> enable row level security;

-- Lecture (viewer ou plus)
create policy "members read" on <table_name> for select to authenticated
  using (workspace_id in (select public.user_workspaces('viewer')));

-- Modification (member ou plus)
create policy "members insert" on <table_name> for insert to authenticated
  with check (workspace_id in (select public.user_workspaces('member')));

create policy "members update" on <table_name> for update to authenticated
  using (workspace_id in (select public.user_workspaces('member')))
  with check (workspace_id in (select public.user_workspaces('member')));

-- Suppression (admin/owner uniquement)
create policy "admins delete" on <table_name> for delete to authenticated
  using (workspace_id in (select public.user_workspaces('admin')));
```

**Cas particuliers** :
- `prospect_data_access_logs` : audit RGPD, DELETE = owner uniquement
- `prospect_message_templates` : SELECT/INSERT/UPDATE = admin uniquement (après workspace_id ajout)
- `smartlead_events`, `bouncer_jobs`, `enrichment_cache` : service_role uniquement, pas de policy

### Chiffrement des Secrets

Les clés API stockées dans `workspace_provider_credentials.encrypted_key` :

```typescript
// Chiffrement (edge function, avant storage)
import { encryptToken } from './_shared/token-encryption.ts';

const encryptionKey = Deno.env.get('TOKEN_ENCRYPTION_KEY');
const encrypted = encryptToken(apiKey, encryptionKey);  // base64 (IV + ciphertext + tag)
// INSERT: encrypted_key = encrypted

// Déchiffrement (edge function, at runtime)
import { decryptToken } from './_shared/token-encryption.ts';

const encrypted = await getWorkspaceCredential(workspace_id, 'smartlead');
const apiKey = decryptToken(encrypted, encryptionKey);
// Use apiKey pour appel Smartlead API
```

**IMPORTANT** : les credentials ne DOIVENT JAMAIS transiter par le client PostgREST. Les edge functions accèdent les secrets via service_role (bypass RLS).

---

## Migrations & Versioning

Migrations SQL dans `supabase/migrations/` avec timestamp ISO (YYYYMMDDHHMMSS) :

```
00000000000000_socle.sql                                   — Fondations multi-tenant
20260414120000_create_prospect_tables.sql                  — Prospects, signaux (legacy)
20260520100000_workspace_jay_and_backfill_prospect_tables.sql
20260520110000_workspace_rls_prospect_tables.sql           — RLS workspace-based
20260520130000_split_icp_into_triggers_and_personas.sql    — signal_triggers + icp_personas
20260525090000_workspace_providers_generic.sql             — workspace_providers
20260603120000_workspace_provider_credentials.sql          — Stockage chiffré clés
20260616120000_complete_oss_schema.sql                     — workspace_brand, smartlead_campaigns
20260616230000_drop_dead_tables.sql                        — Cleanup extension_tokens, linkedin_invitation_queue
20260617010000_drop_target_category_legacy.sql             — Drop legacy target_category
```

Appliquer avec :

```bash
supabase db push                           # local (linked project)
supabase migration up --project-ref <ref>  # remote
```

---

## Monitoring & Performance

### Indices Critiques

```sql
-- Lookups workspace-based
create index idx_prospect_profiles_workspace on prospect_profiles(workspace_id);
create index idx_prospect_profiles_persona on prospect_profiles(persona_id) where deleted_at is null;
create index idx_prospect_profiles_deliverability on prospect_profiles(deliverability_status) 
  where deliverability_status = 'valid';

-- Signal processing
create index idx_prospect_signals_workspace_status on prospect_signals(workspace_id, status, detected_at);

-- Email deduction (bounce learning)
create index idx_pattern_audit_events_domain_pattern on pattern_audit_events(domain, pattern_id);

-- Enrichment jobs
create index idx_prospect_enrichment_jobs_status on prospect_enrichment_jobs(workspace_id, status);

-- Search fuzzy (pg_trgm)
create index idx_prospect_profiles_company_trgm on prospect_profiles using gin (company_name gin_trgm_ops);
```

### Real-Time (Supabase)

Real-time peut être activé sur :
- `prospect_profiles` (détection changements deliverability, persona_id)
- `prospect_signals` (nouvelles détections)
- `prospect_messages` (envois, réponses)

```typescript
// Exemple React
const subscription = supabase
  .channel('prospect_profiles')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'prospect_profiles', 
      filter: `workspace_id=eq.${workspaceId}` },
    (payload) => { /* handle change */ }
  )
  .subscribe();
```

### Sécurité

- **RLS obligatoire** sur toutes les tables prospect-related. Pas d'accès sans `user_workspaces()`.
- **Secrets chiffrés** : credentials jamais en clair. Déchiffrer côté edge function (service_role bypass).
- **Rate limiting** : `api_rate_limits` pour protéger webhooks/imports.
- **Audit** : `pattern_audit_events` pour tracer email decisions, `edge_function_logs` pour debug.

---

## Ressources

- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) — Pipeline complet, edge functions
- [ADR 0003 — Multi-tenant Workspace](../docs/ADR.md#adr-0003-multi-tenant-workspace-id) — Décisions architecturales
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security) — Sécurité au niveau ligne
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) — Functions Deno

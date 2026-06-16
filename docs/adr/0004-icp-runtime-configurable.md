# ADR 0004 : ICP runtime configurable (table `icp_profiles`)

- **Statut** : Propose
- **Date** : 2026-05-19

## Contexte

L'outil actuel cible **3 categories hardcodees** : `director`, `field_sales`, `hr`. Ce choix vient du business Jay (vendre Jay a des directeurs commerciaux, commerciaux terrain, equipes RH). Aucun autre utilisateur ne peut creer ses propres categories sans :

- Modifier le CHECK constraint sur `prospect_profiles.target_category`
- Modifier le CHECK sur `prospect_sequences`, `prospect_messages`, `prospect_message_templates`
- Modifier les prompts LLM dans `score-prospect-signals`
- Modifier les templates seedes
- Modifier l'UI

Pour servir tous les domaines (recrutement, immobilier, retail, edutech, etc.), il faut que **chaque utilisateur definisse ses propres ICP a l'UI**.

## Decision

Remplacer l'enum hardcode par une table editable `icp_profiles`, scope au workspace :

```sql
CREATE TABLE icp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identite
  slug TEXT NOT NULL,                      -- 'director', 'restaurant-owner', etc. (kebab-case)
  label TEXT NOT NULL,                     -- "Directeur Commercial PME"
  description TEXT,                        -- Optionnel pour l'UI
  icon TEXT,                               -- Nom Lucide icon (optionnel)

  -- Sourcing : comment trouver ces leads
  search_keywords TEXT[] NOT NULL DEFAULT '{}',  -- ["directeur commercial", "head of sales"]
  job_title_patterns TEXT[] DEFAULT '{}',        -- regex / globs
  company_size_min INT,
  company_size_max INT,
  industry_filters TEXT[] DEFAULT '{}',          -- NAF codes ou keywords
  geo_filters JSONB DEFAULT '[]'::jsonb,         -- [{country, regions, cities}]
  exclude_keywords TEXT[] DEFAULT '{}',          -- ["stage", "freelance", "alternance"]

  -- Scoring : prompt LLM + axes
  scoring_prompt TEXT NOT NULL,                  -- "Tu evalues si ce signal correspond a..."
  scoring_axes JSONB DEFAULT '[
    {"name": "fit_company", "max": 60, "description": "..."},
    {"name": "signal_strength", "max": 40, "description": "..."}
  ]'::jsonb,
  scoring_qualification_threshold INT DEFAULT 60, -- au-dessus = qualified
  elimination_rules JSONB DEFAULT '[]'::jsonb,   -- conditions qui forcent score = 0

  -- Routing : canaux preferes
  channels_priority TEXT[] DEFAULT ARRAY['email'],
  channels_config JSONB DEFAULT '{}'::jsonb,     -- {email: {delay_days: 0}, linkedin: {delay_days: 3}}

  -- Etat
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,              -- au moins un par workspace
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE (workspace_id, slug)
);
```

### Migration de l'existant

```sql
-- Suppression des CHECK constraints
ALTER TABLE prospect_profiles DROP CONSTRAINT IF EXISTS prospect_profiles_target_category_check;
ALTER TABLE prospect_sequences DROP CONSTRAINT IF EXISTS prospect_sequences_target_category_check;
-- etc.

-- Ajout des FK
ALTER TABLE prospect_profiles ADD COLUMN icp_profile_id UUID REFERENCES icp_profiles(id);
ALTER TABLE prospect_sequences ADD COLUMN icp_profile_id UUID REFERENCES icp_profiles(id);
ALTER TABLE prospect_messages ADD COLUMN icp_profile_id UUID REFERENCES icp_profiles(id);
ALTER TABLE prospect_message_templates ADD COLUMN icp_profile_id UUID REFERENCES icp_profiles(id);

-- Seed des 3 ICP Jay actuels dans le workspace Jay
INSERT INTO icp_profiles (workspace_id, slug, label, search_keywords, scoring_prompt, channels_priority)
VALUES
  (jay_workspace_id, 'director', 'Directeur Commercial', ARRAY['directeur commercial'], '...', ARRAY['email','linkedin','postal_letter']),
  (jay_workspace_id, 'field-sales', 'Commercial Terrain', ARRAY['commercial terrain'], '...', ARRAY['email','linkedin','instagram']),
  (jay_workspace_id, 'hr', 'RH PME', ARRAY['responsable RH'], '...', ARRAY['email']);

-- Backfill les rows existants
UPDATE prospect_profiles SET icp_profile_id = (
  SELECT id FROM icp_profiles WHERE workspace_id = jay_workspace_id AND slug = prospect_profiles.target_category
);

-- (Eventuellement) Drop la colonne target_category apres validation
-- ALTER TABLE prospect_profiles DROP COLUMN target_category;
```

### UI editor

Une page `/icp` avec :
- Liste des ICP existants
- Bouton "Creer un ICP"
- Form : slug, label, keywords, scoring prompt (textarea avec syntax highlight), channels picker (drag-drop)
- Preview du scoring prompt + test sur un signal exemple
- Templates preset : "SaaS B2B sales", "RH PME", "Restaurant owner", "Real estate agent"

### Import/Export YAML

```yaml
# icp-director.yaml
slug: director
label: "Directeur Commercial"
description: "Decideur ventes en PME/ETI"
search_keywords:
  - directeur commercial
  - head of sales
  - vp sales
company_size_min: 50
company_size_max: 5000
scoring_prompt: |
  Tu evalues si ce signal correspond a un directeur commercial...
channels_priority: [email, linkedin, postal_letter]
```

L'utilisateur peut versionner ses ICP en git (utile pour les devs OSS).

## Consequences

### Positives

- **Configuration sans code** : un user non-tech cree des ICP via UI
- **Multi-domaine** : couvre recrutement, immobilier, retail, etc.
- **Versionning** : possibilite d'export YAML pour git
- **Templates communautaires** : on peut publier des presets ICP repo public ("preset packs")
- **Scoring custom** : prompt LLM par ICP, pas un prompt global
- **Channel routing flexible** : chaque ICP definit sa sequence

### Negatives

- **Migration data lourde** : 4 tables a alter + backfill
- **UI editor a construire** : pas trivial (form complexe, preview scoring)
- **Validation runtime** : le prompt scoring doit etre verifie (longueur, contenu, pas de prompt injection a l'envers)
- **Performance scoring** : un prompt different par ICP = plus de variability LLM, plus de tokens
- **Onboarding utilisateur** : il faut guider l'user a creer son premier ICP (sinon ecran blanc = abandon)

### Mitigations

- **Onboarding wizard** : premiere connexion = wizard qui propose 5 templates ICP a piocher, modifier, sauver
- **Validation Zod** : schema strict pour `icp_profiles`, refus a l'insert si prompt < 100 chars ou > 5000 chars
- **Cache LLM** : les prompts ICP changent rarement, mise en cache des contextes
- **Preset library** : repo `jay-reach-icp-presets` publie sur GitHub avec des templates contribues par la communaute

## Alternatives considerees

### Alt 1 : Garder l'enum + ajouter un champ JSONB "custom" pour les valeurs hors-Jay

Rejete. Bricolage, ne resout pas le scoring prompt hardcode. Schema sale.

### Alt 2 : ICP en YAML/JSON config files seulement (pas de UI)

Rejete. SaaS-friendly = UI necessaire. Mais on garde l'option import/export YAML pour les devs OSS.

### Alt 3 : ICP global cross-workspace (presets partages)

Rejete. Chaque user a son propre business, ses propres formulations. Mais on peut avoir un repo de presets externe.

### Alt 4 : Pas de scoring prompt par ICP, juste des filtres declaratifs

Rejete. Trop limite. Le scoring LLM est l'asset principal, il doit etre configurable.

## Open questions

- Comment versioner les ICP ? (table `icp_profile_versions` ? juste un champ `version` int ?)
- Comment gerer les ICP "deprecated" (deja utilises par des prospects existants) ?
- Faut-il un editor de scoring axes (UI custom pour les axes JSONB) ?

A trancher en phase 1.2.

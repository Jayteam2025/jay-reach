-- =============================================================================
-- Jay Reach Phase 1.2.1 — Table icp_profiles (remplace enum target_category)
-- Reference : docs/jay-reach/adr/0004-icp-runtime-configurable.md
-- Issue : https://github.com/Jayteam2025/jay/issues/361
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table icp_profiles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.icp_profiles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Identite
  slug         TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  label        TEXT        NOT NULL,
  description  TEXT,
  icon         TEXT,  -- Nom Lucide icon (optionnel)

  -- Sourcing : comment trouver ces leads
  search_keywords       TEXT[]   NOT NULL DEFAULT '{}',
  job_title_patterns    TEXT[]   NOT NULL DEFAULT '{}',
  company_size_min      INT,
  company_size_max      INT,
  industry_filters      TEXT[]   NOT NULL DEFAULT '{}',
  geo_filters           JSONB    NOT NULL DEFAULT '[]'::jsonb,
  exclude_keywords      TEXT[]   NOT NULL DEFAULT '{}',

  -- Scoring : prompt LLM + axes
  scoring_prompt        TEXT     NOT NULL,
  scoring_axes          JSONB    NOT NULL DEFAULT '[
    {"name": "fit_company", "max": 60, "description": "Le signal correspond a une entreprise cible"},
    {"name": "signal_strength", "max": 40, "description": "Le signal est fort et actionnable"}
  ]'::jsonb,
  scoring_qualification_threshold INT NOT NULL DEFAULT 60,
  elimination_rules     JSONB    NOT NULL DEFAULT '[]'::jsonb,

  -- Routing : canaux preferes
  channels_priority     TEXT[]   NOT NULL DEFAULT ARRAY['email'],
  channels_config       JSONB    NOT NULL DEFAULT '{}'::jsonb,

  -- Etat
  is_active             BOOLEAN  NOT NULL DEFAULT TRUE,
  is_default            BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID     REFERENCES auth.users(id) ON DELETE SET NULL,

  UNIQUE (workspace_id, slug)
);

COMMENT ON TABLE  public.icp_profiles                     IS 'Profils ICP (Ideal Customer Profile) editables par workspace. Remplace l''enum target_category hardcode.';
COMMENT ON COLUMN public.icp_profiles.slug                IS 'Identifiant URL-friendly unique par workspace (lowercase, kebab-case).';
COMMENT ON COLUMN public.icp_profiles.search_keywords     IS 'Mots-cles pour le scraping (job boards, LinkedIn).';
COMMENT ON COLUMN public.icp_profiles.scoring_prompt      IS 'Prompt LLM pour scorer les signaux de cet ICP.';
COMMENT ON COLUMN public.icp_profiles.scoring_axes        IS 'Axes de scoring avec nom, max points, description.';
COMMENT ON COLUMN public.icp_profiles.elimination_rules   IS 'Regles qui forcent un score = 0 (DQ direct).';
COMMENT ON COLUMN public.icp_profiles.channels_priority   IS 'Ordre des canaux d''outreach pour cet ICP.';
COMMENT ON COLUMN public.icp_profiles.is_default          IS 'Indique l''ICP par defaut du workspace (au max un seul).';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_icp_profiles_workspace_active
  ON public.icp_profiles(workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_icp_profiles_workspace_slug
  ON public.icp_profiles(workspace_id, slug);

-- ---------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trigger_icp_profiles_updated_at
  BEFORE UPDATE ON public.icp_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. RLS workspace-based
-- ---------------------------------------------------------------------------

ALTER TABLE public.icp_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read" ON public.icp_profiles
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));

CREATE POLICY "admins insert" ON public.icp_profiles
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

CREATE POLICY "admins update" ON public.icp_profiles
  FOR UPDATE TO authenticated
  USING      (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

CREATE POLICY "admins delete" ON public.icp_profiles
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- 5. Seed des 3 ICP Jay actuels (COMMENTED OUT for OSS - only for Jay)
-- ---------------------------------------------------------------------------
-- The Jay workspace and ICPs are hardcoded in Jay. OSS users create their own.
-- Uncomment these INSERTs if migrating an existing Jay instance to OSS.

-- INSERT INTO public.icp_profiles (
--   workspace_id, slug, label, description,
--   search_keywords, exclude_keywords,
--   scoring_prompt, channels_priority, is_default
-- ) VALUES
-- (
--   '00000000-0000-0000-0000-000000000001',
--   'director',
--   'Directeur Commercial PME',
--   'Decideur ventes en PME/ETI (Directeur Commercial, Head of Sales, VP Sales, DG ventes).',
--   ARRAY['directeur commercial', 'head of sales', 'vp sales', 'directeur des ventes', 'directrice commerciale'],
--   ARRAY['stage', 'freelance', 'alternance', 'mission'],
--   E'Tu evalues si ce signal correspond a un Directeur Commercial en PME/ETI (50-5000 employes).\n\nAxes de scoring :\n- FIT ENTREPRISE (0-60) : taille, secteur, signaux de croissance (recrutement vendeurs, levee de fonds, nouvelle equipe)\n- FORCE DU SIGNAL (0-40) : recence, intentionnalite, contexte\n\nElimine immediatement (score = 0) :\n- Stages, alternances, freelances, missions < 3 mois\n- Postes operationnels (commercial terrain, agent commercial)\n- Entreprises < 50 ou > 5000 employes\n\nRetourne un JSON {"score": 0-100, "rationale": "...", "axes": {...}}.',
--   ARRAY['email', 'linkedin', 'postal_letter'],
--   TRUE
-- ),
-- (
--   '00000000-0000-0000-0000-000000000001',
--   'field-sales',
--   'Commercial Terrain',
--   'Vendeur en mobilite (Sales Rep, Business Developer, Account Executive, Technico-commercial).',
--   ARRAY['commercial terrain', 'sales rep', 'business developer', 'account executive', 'technico-commercial', 'commercial itinerant'],
--   ARRAY['stage', 'alternance'],
--   E'Tu evalues si ce signal correspond a un Commercial Terrain (vendeur en mobilite, B2B).\n\nAxes de scoring :\n- FIT POSTE (0-60) : Mobilite reelle, secteur compatible, autonomie commerciale\n- FORCE DU SIGNAL (0-40) : recence, qualite de la source\n\nElimine immediatement (score = 0) :\n- Stages, alternances\n- Postes sedentaires (telesales, inside sales pur)\n- Roles non-commerciaux\n\nRetourne un JSON {"score": 0-100, "rationale": "...", "axes": {...}}.',
--   ARRAY['email', 'linkedin', 'instagram'],
--   FALSE
-- ),
-- (
--   '00000000-0000-0000-0000-000000000001',
--   'hr',
--   'RH PME (Signal Recrutement)',
--   'Decideur RH dans une PME qui recrute des commerciaux (DRH, Talent Acquisition, Responsable Recrutement).',
--   ARRAY['responsable RH', 'DRH', 'recruteur', 'talent acquisition', 'responsable recrutement', 'chargee de recrutement'],
--   ARRAY['cabinet de recrutement', 'cabinet recrutement', 'consulting RH'],
--   E'Tu evalues si ce signal correspond a une fonction RH/Recrutement dans une PME qui recrute activement des profils commerciaux.\n\nAxes de scoring :\n- FIT ENTREPRISE + ROLE (0-60) : Entreprise PME 50-2000 employes, role RH operationnel\n- SIGNAL RECRUTEMENT COMMERCIAL (0-40) : Annonces recentes pour vendeurs, multiples postes ouverts\n\nElimine immediatement (score = 0) :\n- Cabinets de recrutement (on ne demarche pas ceux qui recrutent pour les autres)\n- Recrutement non-commercial uniquement (RH/tech/finance)\n- Stages, alternances\n\nRetourne un JSON {"score": 0-100, "rationale": "...", "axes": {...}}.',
--   ARRAY['email'],
--   FALSE
-- )
-- ON CONFLICT (workspace_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Contrainte : un seul ICP default par workspace
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_icp_profiles_one_default_per_workspace
  ON public.icp_profiles(workspace_id)
  WHERE is_default = TRUE;

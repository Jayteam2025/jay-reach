-- =============================================================================
-- Jay Reach Phase 1.2.1bis — Separer ICP en signal_triggers + icp_personas
-- Reference : memoire jay-reach-icp-vs-triggers-model + docs ADR 0004 (a updater)
--
-- AVANT : icp_profiles melangeait 2 concepts (scrape + persona)
-- APRES :
--   - signal_triggers : COMMENT trouver les boites (filtres scrape)
--   - icp_personas    : QUI contacter dans la boite (cibles enrichissement)
--
-- Cas Jay :
--   - 1 trigger "Recrutement commerciaux" (annonces de commerciaux uniquement)
--   - 3 personas : DRH, Directeur Commercial, Commercial
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rename icp_profiles -> icp_personas (garde le contenu)
-- ---------------------------------------------------------------------------

ALTER TABLE public.icp_profiles RENAME TO icp_personas;

-- Renommer les indexes et contraintes pour coherence
ALTER INDEX IF EXISTS idx_icp_profiles_workspace_active
  RENAME TO idx_icp_personas_workspace_active;
ALTER INDEX IF EXISTS idx_icp_profiles_workspace_slug
  RENAME TO idx_icp_personas_workspace_slug;
ALTER INDEX IF EXISTS idx_icp_profiles_one_default_per_workspace
  RENAME TO idx_icp_personas_one_default_per_workspace;
ALTER INDEX IF EXISTS icp_profiles_pkey
  RENAME TO icp_personas_pkey;
ALTER INDEX IF EXISTS icp_profiles_workspace_id_slug_key
  RENAME TO icp_personas_workspace_id_slug_key;

-- Trigger
ALTER TRIGGER trigger_icp_profiles_updated_at
  ON public.icp_personas
  RENAME TO trigger_icp_personas_updated_at;

-- ---------------------------------------------------------------------------
-- 2. Cleanup champs trigger-related (ils degagent vers signal_triggers)
--    Drop search_keywords, exclude_keywords, industry_filters,
--    geo_filters, company_size_min/max
-- ---------------------------------------------------------------------------

ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS search_keywords;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS exclude_keywords;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS industry_filters;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS geo_filters;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS company_size_min;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS company_size_max;
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS elimination_rules;

-- ---------------------------------------------------------------------------
-- 3. Ajout champs persona-specific
-- ---------------------------------------------------------------------------

ALTER TABLE public.icp_personas ADD COLUMN IF NOT EXISTS job_title_keywords TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.icp_personas ADD COLUMN IF NOT EXISTS seniority_levels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.icp_personas ADD COLUMN IF NOT EXISTS department_patterns TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.icp_personas ADD COLUMN IF NOT EXISTS exclude_titles TEXT[] NOT NULL DEFAULT '{}';

-- Renommer scoring_prompt -> persona_scoring_prompt (clarte)
ALTER TABLE public.icp_personas RENAME COLUMN scoring_prompt TO persona_scoring_prompt;

-- Renommer scoring_qualification_threshold -> persona_match_threshold
ALTER TABLE public.icp_personas RENAME COLUMN scoring_qualification_threshold TO persona_match_threshold;

-- Drop l'ancien job_title_patterns (remplace par job_title_keywords plus explicite)
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS job_title_patterns;

COMMENT ON TABLE  public.icp_personas IS 'Personas (qui contacter) cibles dans les boites detectees par les signal_triggers. Pas a confondre avec signal_triggers (criteres de scrape).';
COMMENT ON COLUMN public.icp_personas.job_title_keywords IS 'Mots-cles dans les titres de poste qui matchent ce persona.';
COMMENT ON COLUMN public.icp_personas.seniority_levels IS 'Niveaux hierarchiques (director, manager, individual_contributor, c_level, etc.).';
COMMENT ON COLUMN public.icp_personas.department_patterns IS 'Departements ou roles fonctionnels (Sales, HR, Engineering, etc.).';

-- ---------------------------------------------------------------------------
-- 4. Update du seed Jay (COMMENTED OUT for OSS - Jay-specific)
-- ---------------------------------------------------------------------------
-- These UPDATEs reference the hardcoded Jay workspace which doesn't exist in OSS.
-- Uncomment if migrating an existing Jay instance.

-- UPDATE public.icp_personas
-- SET
--   job_title_keywords = ARRAY['directeur commercial', 'directrice commerciale', 'head of sales', 'vp sales', 'sales director', 'directeur des ventes', 'chief sales officer', 'cso'],
--   seniority_levels = ARRAY['director', 'c_level'],
--   department_patterns = ARRAY['Sales', 'Commercial'],
--   exclude_titles = ARRAY['assistant', 'stagiaire']
-- WHERE workspace_id = '00000000-0000-0000-0000-000000000001' AND slug = 'director';

-- UPDATE public.icp_personas
-- SET
--   job_title_keywords = ARRAY['commercial terrain', 'sales rep', 'sales representative', 'business developer', 'account executive', 'technico-commercial', 'commercial itinerant', 'attache commercial'],
--   seniority_levels = ARRAY['individual_contributor', 'manager'],
--   department_patterns = ARRAY['Sales', 'Commercial'],
--   exclude_titles = ARRAY['directeur', 'head of', 'vp', 'cso', 'stagiaire']
-- WHERE workspace_id = '00000000-0000-0000-0000-000000000001' AND slug = 'field-sales';

-- UPDATE public.icp_personas
-- SET
--   slug = 'hr-decision-maker',
--   label = 'RH decideur (DRH, Responsable RH)',
--   description = 'Le decideur RH dans la boite ciblee. Pas un cabinet de recrutement externe.',
--   job_title_keywords = ARRAY['drh', 'directeur des ressources humaines', 'directrice des ressources humaines', 'responsable rh', 'responsable ressources humaines', 'talent acquisition manager', 'people manager', 'chief people officer', 'chief human resources officer', 'chro'],
--   seniority_levels = ARRAY['director', 'manager', 'c_level'],
--   department_patterns = ARRAY['HR', 'Human Resources', 'People', 'Talent'],
--   exclude_titles = ARRAY['cabinet', 'consultant', 'freelance', 'stagiaire']
-- WHERE workspace_id = '00000000-0000-0000-0000-000000000001' AND slug = 'hr';

-- ---------------------------------------------------------------------------
-- 5. Table signal_triggers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signal_triggers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Identite
  slug         TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  label        TEXT        NOT NULL,
  description  TEXT,
  icon         TEXT,

  -- Comment trouver les boites (filtres de scrape)
  search_keywords       TEXT[]   NOT NULL DEFAULT '{}',
  exclude_keywords      TEXT[]   NOT NULL DEFAULT '{}',
  source_types          TEXT[]   NOT NULL DEFAULT ARRAY['adzuna', 'france_travail'],

  -- Filtres entreprise
  company_size_min      INT,
  company_size_max      INT,
  industry_filters      TEXT[]   NOT NULL DEFAULT '{}',
  geo_filters           JSONB    NOT NULL DEFAULT '[]'::jsonb,

  -- Scoring du SIGNAL (= "ce signal est-il une boite vraiment interessante ?")
  signal_scoring_prompt TEXT     NOT NULL,
  signal_match_threshold INT     NOT NULL DEFAULT 60,
  elimination_rules     JSONB    NOT NULL DEFAULT '[]'::jsonb,

  -- Etat
  is_active             BOOLEAN  NOT NULL DEFAULT TRUE,
  is_default            BOOLEAN  NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID     REFERENCES auth.users(id) ON DELETE SET NULL,

  UNIQUE (workspace_id, slug)
);

COMMENT ON TABLE  public.signal_triggers IS 'Declencheurs : comment trouver les boites interessantes (filtres de scrape). Distinct des icp_personas (qui contacter dans les boites trouvees).';
COMMENT ON COLUMN public.signal_triggers.search_keywords IS 'Mots-cles pour le scrape (Adzuna, France Travail, Brave, LinkedIn Jobs).';
COMMENT ON COLUMN public.signal_triggers.source_types IS 'Sources de scrape activees pour ce trigger.';
COMMENT ON COLUMN public.signal_triggers.signal_scoring_prompt IS 'Prompt LLM pour qualifier le signal (la boite est-elle un bon match ?).';

CREATE INDEX IF NOT EXISTS idx_signal_triggers_workspace_active
  ON public.signal_triggers(workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_signal_triggers_workspace_slug
  ON public.signal_triggers(workspace_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_triggers_one_default_per_workspace
  ON public.signal_triggers(workspace_id)
  WHERE is_default = TRUE;

-- Trigger updated_at
CREATE TRIGGER trigger_signal_triggers_updated_at
  BEFORE UPDATE ON public.signal_triggers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS workspace-based
ALTER TABLE public.signal_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read" ON public.signal_triggers
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));

CREATE POLICY "admins insert" ON public.signal_triggers
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

CREATE POLICY "admins update" ON public.signal_triggers
  FOR UPDATE TO authenticated
  USING      (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

CREATE POLICY "admins delete" ON public.signal_triggers
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- 6. Seed du trigger Jay (COMMENTED OUT for OSS - Jay-specific)
-- ---------------------------------------------------------------------------
-- This INSERT references the hardcoded Jay workspace which doesn't exist in OSS.
-- Uncomment if migrating an existing Jay instance.

-- INSERT INTO public.signal_triggers (
--   workspace_id, slug, label, description,
--   search_keywords, exclude_keywords, source_types,
--   company_size_min, company_size_max,
--   signal_scoring_prompt, signal_match_threshold,
--   is_default
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000001',
--   'recrutement-commerciaux',
--   'Boite qui recrute des commerciaux',
--   'Detecte les boites en croissance commerciale via leurs annonces de recrutement de commerciaux. Ces boites sont les cibles ideales pour vendre un outil d''aide a la prospection.',
--   ARRAY['commercial', 'commerciaux', 'vendeur', 'vendeuse', 'sales', 'business developer', 'account executive', 'technico-commercial', 'attache commercial', 'commercial terrain', 'sales representative', 'sales rep'],
--   ARRAY['cabinet', 'recrutement', 'consultant', 'consulting', 'freelance', 'mission', 'stage', 'alternance', 'apprentissage'],
--   ARRAY['adzuna', 'france_travail', 'brave'],
--   50,
--   5000,
--   E'Tu evalues si cette annonce de recrutement correspond a une boite qui recrute reellement des commerciaux internes (pas un cabinet de recrutement externe).\n\nAxes de scoring :\n- VRAIE OFFRE INTERNE (0-50) : l''entreprise recrute pour son propre compte, pas pour un client\n- TAILLE ENTREPRISE (0-30) : PME/ETI entre 50 et 5000 employes (cible Jay)\n- INTENT (0-20) : multiplicite des postes ouverts, offres recentes, croissance visible\n\nElimine immediatement (score = 0) :\n- Cabinets de recrutement / consultants RH\n- Stages, alternances, freelances\n- Entreprises < 50 ou > 5000 employes\n- Postes non-commerciaux deguises (admin des ventes, support client, etc.)\n\nRetourne un JSON {"score": 0-100, "rationale": "...", "axes": {...}}.',
--   60,
--   TRUE
-- )
-- ON CONFLICT (workspace_id, slug) DO NOTHING;

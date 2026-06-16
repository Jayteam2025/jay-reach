-- ============================================================================
-- COMPLETION OSS SCHEMA v1.0 (2026-06-16)
-- ============================================================================
-- Ajoute les objets DB manquants pour que le frontend complet fonctionne :
-- - Tables : workspace_brand, linkedin_invitation_queue
-- - Colonnes : profiles.trial_started_at, profiles.trial_used
-- - RPC : get_prospection_dashboard_stats, get_all_companies_progress,
--         get_last_enrichment_run_company_ids, get_company_name_map,
--         count_non_sent_messages
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLE: workspace_brand (branding par workspace)
-- ---------------------------------------------------------------------------
-- Decouple le branding du code Jay-specifique.
-- attachments JSONB : tableau de
--   { persona_id?, channel?, type: 'inline_image' | 'pdf', url, alt? }

CREATE TABLE IF NOT EXISTS public.workspace_brand (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_name TEXT,
  signature TEXT,
  hero_image_url TEXT,
  founder_name TEXT,
  product_pitch TEXT,
  app_url TEXT,
  notification_recipients TEXT[] NOT NULL DEFAULT '{}',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_brand IS
  'Branding par workspace : signature email, hero, attachments (CV inline, etc.). 1-1 avec workspaces.';

COMMENT ON COLUMN public.workspace_brand.founder_name IS
  'Nom du founder/auteur des messages. Substitue {{founder_name}} dans les prompts.';

COMMENT ON COLUMN public.workspace_brand.product_pitch IS
  'Court resume du produit pour le system prompt LLM. Substitue {{product_pitch}}.';

COMMENT ON COLUMN public.workspace_brand.app_url IS
  'URL de l app pour les liens dans les emails recap. Ex: https://app.example.com/prospection';

COMMENT ON COLUMN public.workspace_brand.notification_recipients IS
  'Liste d emails destinataires des notifications (recap hebdo, alertes). Vide = pas d envoi.';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.workspace_brand_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_brand_updated_at ON public.workspace_brand;
CREATE TRIGGER workspace_brand_updated_at
  BEFORE UPDATE ON public.workspace_brand
  FOR EACH ROW EXECUTE FUNCTION public.workspace_brand_set_updated_at();

-- RLS workspace-based
ALTER TABLE public.workspace_brand ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_brand_select_viewer" ON public.workspace_brand;
DROP POLICY IF EXISTS "workspace_brand_insert_admin" ON public.workspace_brand;
DROP POLICY IF EXISTS "workspace_brand_update_admin" ON public.workspace_brand;
DROP POLICY IF EXISTS "workspace_brand_delete_admin" ON public.workspace_brand;

CREATE POLICY "workspace_brand_select_viewer"
  ON public.workspace_brand FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('viewer')));

CREATE POLICY "workspace_brand_insert_admin"
  ON public.workspace_brand FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));

CREATE POLICY "workspace_brand_update_admin"
  ON public.workspace_brand FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));

CREATE POLICY "workspace_brand_delete_admin"
  ON public.workspace_brand FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- 2. TABLE: linkedin_invitation_queue
-- ---------------------------------------------------------------------------
-- File d'attente des invitations LinkedIn. Partenaire de prospect_signals.
-- Indexation sur (workspace_id, status) pour le polling.

CREATE TABLE IF NOT EXISTS public.linkedin_invitation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES public.prospect_signals(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES public.prospect_profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  method TEXT NOT NULL DEFAULT 'extension_auto'
    CHECK (method IN ('extension_auto', 'cowork_csv', 'manual')),
  attempts INT NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.linkedin_invitation_queue IS
  'File d''attente des invitations LinkedIn auto envoyees. Rate limit: 200/7j glissants, 20min entre, 8h-21h Europe/Paris.';

-- Un signal ne peut etre dans la queue qu'une seule fois en etat actif
CREATE UNIQUE INDEX IF NOT EXISTS uq_linkedin_invitation_queue_active_signal
  ON public.linkedin_invitation_queue(signal_id)
  WHERE status IN ('pending', 'processing', 'sent');

CREATE INDEX IF NOT EXISTS idx_linkedin_invitation_queue_workspace_status
  ON public.linkedin_invitation_queue(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_linkedin_invitation_queue_prospect
  ON public.linkedin_invitation_queue(prospect_id, status);

CREATE INDEX IF NOT EXISTS idx_linkedin_invitation_queue_scheduled
  ON public.linkedin_invitation_queue(scheduled_for)
  WHERE status = 'pending';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.linkedin_invitation_queue_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS linkedin_invitation_queue_updated_at ON public.linkedin_invitation_queue;
CREATE TRIGGER linkedin_invitation_queue_updated_at
  BEFORE UPDATE ON public.linkedin_invitation_queue
  FOR EACH ROW EXECUTE FUNCTION public.linkedin_invitation_queue_set_updated_at();

-- RLS : workspace-based
ALTER TABLE public.linkedin_invitation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "linkedin_queue_select" ON public.linkedin_invitation_queue;
DROP POLICY IF EXISTS "linkedin_queue_insert" ON public.linkedin_invitation_queue;
DROP POLICY IF EXISTS "linkedin_queue_update" ON public.linkedin_invitation_queue;
DROP POLICY IF EXISTS "linkedin_queue_delete" ON public.linkedin_invitation_queue;

CREATE POLICY "linkedin_queue_select"
  ON public.linkedin_invitation_queue FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('viewer')));

CREATE POLICY "linkedin_queue_insert"
  ON public.linkedin_invitation_queue FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('member')));

CREATE POLICY "linkedin_queue_update"
  ON public.linkedin_invitation_queue FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('member')));

CREATE POLICY "linkedin_queue_delete"
  ON public.linkedin_invitation_queue FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- 3. ALTER TABLE profiles : ajouter colonnes trial
-- ---------------------------------------------------------------------------
-- trial_started_at, trial_used : colonnes optionnelles pour compatibilite avec
-- le frontend. Ne sont jamais utilisees en OSS (toujours false/null).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4. HELPER FUNCTION: normalize_company_name_sql
-- ---------------------------------------------------------------------------
-- Mirror Postgres de normalizeName cote frontend (useCrossDetection).
-- Pour matching cross-company.

CREATE OR REPLACE FUNCTION public.normalize_company_name_sql(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      lower(p_name),
      '\b(sas|sa|sarl|eurl|sasu|group|groupe|france|international|holding)\b',
      '',
      'gi'
    ),
    '[^a-z0-9]',
    '',
    'g'
  );
$$;

COMMENT ON FUNCTION public.normalize_company_name_sql IS
  'Mirror Postgres de normalizeName cote frontend (useCrossDetection). Pour matching cross-company.';

-- ---------------------------------------------------------------------------
-- 5. RPC: get_prospection_dashboard_stats
-- ---------------------------------------------------------------------------
-- Agrege tous les compteurs du dashboard prospection en 1 query.
-- Remplace les calculs JS qui plantaient a >1000 profils.

CREATE OR REPLACE FUNCTION public.get_prospection_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_members
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no workspace for user %', v_user_id;
  END IF;

  WITH push AS (
    SELECT
      target_category,
      COUNT(*) FILTER (WHERE
        smartlead_push_decision IS NULL
        OR smartlead_push_decision != 'push'
      )::INT AS pushable,
      COUNT(*) FILTER (WHERE
        smartlead_push_decision = 'push'
      )::INT AS sent
    FROM public.prospect_profiles
    WHERE workspace_id = v_workspace_id
      AND bouncer_status = 'valid'
      AND email IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY target_category
  )
  SELECT jsonb_build_object(
    'scored',
      (SELECT COUNT(*)::INT FROM public.prospect_signals
       WHERE workspace_id = v_workspace_id
         AND status = 'raw'
         AND signal_type = 'job_posting'
         AND (extracted_data ? 'ai_score')),
    'enriched',
      (SELECT COUNT(DISTINCT company_group_id)::INT FROM public.prospect_profiles
       WHERE workspace_id = v_workspace_id
         AND company_group_id IS NOT NULL
         AND deleted_at IS NULL),
    'scrape_count',
      (SELECT COUNT(*)::INT FROM public.prospect_signals
       WHERE workspace_id = v_workspace_id
         AND acquisition_method IN ('adzuna', 'france_travail', 'apify')),
    'import_count',
      (SELECT COUNT(*)::INT FROM public.prospect_signals
       WHERE workspace_id = v_workspace_id
         AND acquisition_method = 'file_upload'),
    'push_counts', jsonb_build_object(
      'hr', COALESCE((SELECT pushable FROM push WHERE target_category = 'hr'), 0),
      'director', COALESCE((SELECT pushable FROM push WHERE target_category = 'director'), 0),
      'field_sales', COALESCE((SELECT pushable FROM push WHERE target_category = 'field_sales'), 0)
    ),
    'push_sent_counts', jsonb_build_object(
      'hr', COALESCE((SELECT sent FROM push WHERE target_category = 'hr'), 0),
      'director', COALESCE((SELECT sent FROM push WHERE target_category = 'director'), 0),
      'field_sales', COALESCE((SELECT sent FROM push WHERE target_category = 'field_sales'), 0)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_prospection_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public.get_prospection_dashboard_stats IS
  'Stats agreges dashboard prospection (workspace de l''user appelant).';

-- ---------------------------------------------------------------------------
-- 6. RPC: get_company_name_map
-- ---------------------------------------------------------------------------
-- Mapping (normalized_company_name -> company_group_id) du workspace
-- pour cross-match LinkedIn.

CREATE OR REPLACE FUNCTION public.get_company_name_map()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_members
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH first_per_name AS (
    SELECT DISTINCT ON (public.normalize_company_name_sql(company_name))
      public.normalize_company_name_sql(company_name) AS norm,
      company_group_id
    FROM public.prospect_profiles
    WHERE workspace_id = v_workspace_id
      AND deleted_at IS NULL
      AND company_group_id IS NOT NULL
      AND company_name IS NOT NULL
    ORDER BY public.normalize_company_name_sql(company_name), created_at ASC
  )
  SELECT COALESCE(jsonb_object_agg(norm, company_group_id), '{}'::jsonb)
  INTO v_result
  FROM first_per_name
  WHERE norm IS NOT NULL AND norm != '';

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_name_map() TO authenticated;

COMMENT ON FUNCTION public.get_company_name_map IS
  'Mapping (normalized_company_name -> company_group_id) du workspace pour cross-match LinkedIn.';

-- ---------------------------------------------------------------------------
-- 7. RPC: get_all_companies_progress
-- ---------------------------------------------------------------------------
-- Progress par company_group_id (total/completed/percent) pour tous les groupes.
-- RPC agrege cote DB au lieu de charger toutes les tables frontend.

CREATE OR REPLACE FUNCTION public.get_all_companies_progress()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_members
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH expected AS (
    SELECT
      pp.company_group_id,
      SUM(
        CASE WHEN COALESCE(ip.slug, '') = 'hr-decision-maker' OR pp.target_category = 'hr' THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(ip.slug, '') = 'director' OR pp.target_category = 'director' THEN 1 ELSE 0 END +
        CASE WHEN pp.linkedin_url IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN (COALESCE(ip.slug, '') = 'field-sales' OR pp.target_category = 'field_sales')
              AND pp.instagram_url IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN (COALESCE(ip.slug, '') = 'field-sales' OR pp.target_category = 'field_sales')
              AND pp.tiktok_url IS NOT NULL THEN 1 ELSE 0 END
      )::INT AS total_expected
    FROM public.prospect_profiles pp
    LEFT JOIN public.icp_personas ip ON ip.id = pp.persona_id
    WHERE pp.workspace_id = v_workspace_id
      AND pp.deleted_at IS NULL
      AND pp.company_group_id IS NOT NULL
    GROUP BY pp.company_group_id
  ),
  completed AS (
    SELECT
      company_group_id,
      COUNT(DISTINCT prospect_id || ':' || channel)::INT AS done_count
    FROM public.prospect_actions
    WHERE workspace_id = v_workspace_id
      AND company_group_id IS NOT NULL
    GROUP BY company_group_id
  )
  SELECT jsonb_object_agg(
    e.company_group_id,
    jsonb_build_object(
      'total', e.total_expected,
      'completed', COALESCE(c.done_count, 0),
      'percent', CASE
        WHEN e.total_expected > 0
          THEN ROUND(100.0 * COALESCE(c.done_count, 0) / e.total_expected)::INT
        ELSE 0
      END
    )
  )
  INTO v_result
  FROM expected e
  LEFT JOIN completed c ON c.company_group_id = e.company_group_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_companies_progress() TO authenticated;

COMMENT ON FUNCTION public.get_all_companies_progress IS
  'Progress par company_group_id (total/completed/percent).';

-- ---------------------------------------------------------------------------
-- 8. RPC: count_non_sent_messages
-- ---------------------------------------------------------------------------
-- Compteur draft messages pour (persona, channel).

CREATE OR REPLACE FUNCTION public.count_non_sent_messages(
  p_persona_id UUID,
  p_channel TEXT
) RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id UUID;
  v_count INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.workspace_members
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM public.prospect_messages pm
  JOIN public.prospect_profiles pp ON pp.id = pm.prospect_id
  WHERE pm.workspace_id = v_workspace_id
    AND pp.workspace_id = v_workspace_id
    AND pp.persona_id = p_persona_id
    AND pp.deleted_at IS NULL
    AND pm.channel = p_channel
    AND pm.status NOT IN ('sent', 'replied', 'bounced');

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_non_sent_messages(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.count_non_sent_messages IS
  'Compteur draft messages pour (persona, channel).';

-- ---------------------------------------------------------------------------
-- 9. RPC: get_last_enrichment_run_company_ids
-- ---------------------------------------------------------------------------
-- Entreprises enrichies lors du DERNIER run d'enrichissement (job le plus recent).

CREATE OR REPLACE FUNCTION public.get_last_enrichment_run_company_ids()
RETURNS TABLE(company_group_id UUID)
LANGUAGE sql
STABLE
SET search_path = 'public'
AS $$
  WITH last_job AS (
    SELECT id FROM public.prospect_enrichment_jobs ORDER BY created_at DESC LIMIT 1
  )
  SELECT DISTINCT p.company_group_id
  FROM public.prospect_enrichment_job_items i
  JOIN last_job lj ON lj.id = i.job_id
  JOIN public.prospect_profiles p ON p.source_signal_id = i.signal_id
  WHERE p.company_group_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_last_enrichment_run_company_ids() TO authenticated;

COMMENT ON FUNCTION public.get_last_enrichment_run_company_ids IS
  'Entreprises enrichies lors du DERNIER run d''enrichissement (job le plus recent).';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

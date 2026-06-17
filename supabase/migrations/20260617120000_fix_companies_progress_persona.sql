-- ---------------------------------------------------------------------------
-- get_all_companies_progress : refonte générique (suite au drop de target_category)
-- ---------------------------------------------------------------------------
-- L'ancienne version calculait une « progression » par entreprise avec une
-- heuristique Jay (personas hr/director/field_sales + canaux email/insta/tiktok)
-- en lisant pp.target_category + des slugs de personas Jay. La colonne
-- target_category ayant été supprimée, le RPC renvoyait 400.
--
-- Nouvelle définition générique : l'unique canal d'envoi OSS est l'email.
--   total     = nb de contacts d'une entreprise ayant un email (chacun = 1 envoi attendu)
--   completed = nb de contacts distincts ayant une action enregistrée
--   percent   = completed / total

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
      COUNT(*) FILTER (WHERE pp.email IS NOT NULL)::INT AS total_expected
    FROM public.prospect_profiles pp
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
  'Progress par company_group_id (total/completed/percent), email-only, sans target_category.';

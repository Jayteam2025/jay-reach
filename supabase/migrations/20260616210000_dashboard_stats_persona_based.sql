-- ---------------------------------------------------------------------------
-- get_prospection_dashboard_stats : push counts par persona_id (dé-hardcoding)
-- ---------------------------------------------------------------------------
-- L'ancienne version groupait les compteurs de push Smartlead par les 3
-- target_category Jay historiques (hr / director / field_sales) et filtrait sur
-- bouncer_status. Sur une instance OSS aux personas custom, ces clés ne matchent
-- aucun profil -> badges a 0 + menu "Push Smartlead (toutes boites)" qui affiche
-- "Aucun persona actif".
--
-- Nouvelle version :
--   - groupe par persona_id (n'importe quel jeu de personas) ;
--   - filtre sur deliverability_status = 'valid' (colonne provider-agnostique
--     ecrite par Bouncer/Reoon, coherente avec le gate send-via-smartlead) ;
--   - renvoie push_by_persona : [{ persona_id, pushable, sent }].
-- Le label du persona est resolu cote front (useIcpPersonas), pas besoin de join.

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
      persona_id,
      COUNT(*) FILTER (WHERE
        smartlead_push_decision IS NULL
        OR smartlead_push_decision != 'push'
      )::INT AS pushable,
      COUNT(*) FILTER (WHERE
        smartlead_push_decision = 'push'
      )::INT AS sent
    FROM public.prospect_profiles
    WHERE workspace_id = v_workspace_id
      AND deliverability_status = 'valid'
      AND email IS NOT NULL
      AND deleted_at IS NULL
      AND persona_id IS NOT NULL
    GROUP BY persona_id
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
    'push_by_persona', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'persona_id', persona_id,
        'pushable', pushable,
        'sent', sent
      ))
      FROM push
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_prospection_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION public.get_prospection_dashboard_stats IS
  'Stats agreges dashboard prospection (workspace de l''user appelant). push_by_persona groupe par persona_id, deliverability_status=valid.';

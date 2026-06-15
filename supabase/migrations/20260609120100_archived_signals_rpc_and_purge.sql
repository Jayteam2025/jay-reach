-- 1) RPC paginee des signaux archives (onglet « Archives »).
--    Workspace resolu via auth.uid() (pattern get_enriched_companies_page).
CREATE OR REPLACE FUNCTION public.get_archived_signals(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_workspace_id UUID;
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

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'archived_at') DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', ps.id,
      'company_name', COALESCE(ps.company_name, ps.extracted_data->>'company_name'),
      'ai_score', (ps.extracted_data->>'ai_score'),
      'archived_at', ps.archived_at
    ) AS row
    FROM public.prospect_signals ps
    WHERE ps.workspace_id = v_workspace_id
      AND ps.signal_type = 'job_posting'
      AND ps.status = 'archived'
    ORDER BY ps.archived_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN v_result;
END;
$$;

-- 2) Purge 60j foldee dans cleanup_prospect_retention() (pas de cron concurrent).
--    Option A : la regle raw>14j reste un DELETE inchange (etape 1).
--    Ajout d'une 4e colonne de retour -> changement de signature -> DROP + CREATE
--    (CREATE OR REPLACE seul refuse de changer le type de retour). Seul appelant
--    = le cron prospect-retention-cleanup (SELECT ...; ignore les colonnes), sans risque.
DROP FUNCTION IF EXISTS public.cleanup_prospect_retention();

CREATE FUNCTION public.cleanup_prospect_retention()
RETURNS TABLE (
  signals_raw_deleted INT,
  signals_dismissed_deleted INT,
  profiles_softdeleted_deleted INT,
  signals_archived_deleted INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_signals_raw INT := 0;
  v_signals_dismissed INT := 0;
  v_profiles INT := 0;
  v_signals_archived INT := 0;
BEGIN
  -- 1. Raw signals > 14 jours sans profil enrichi associe (inchange, option A)
  WITH del AS (
    DELETE FROM prospect_signals ps
    WHERE ps.status = 'raw'
      AND ps.created_at < NOW() - INTERVAL '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM prospect_profiles pp
        WHERE pp.source_signal_id = ps.id AND pp.deleted_at IS NULL
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_signals_raw FROM del;

  -- 2. Dismissed signals > 30 jours
  WITH del AS (
    DELETE FROM prospect_signals
    WHERE status = 'dismissed'
      AND created_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_signals_dismissed FROM del;

  -- 3. Profiles soft-deletes > 30 jours
  WITH del AS (
    DELETE FROM prospect_profiles
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '30 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_profiles FROM del;

  -- 4. Archived signals > 60 jours (nouvelle retention glissante)
  WITH del AS (
    DELETE FROM prospect_signals
    WHERE status = 'archived'
      AND archived_at < NOW() - INTERVAL '60 days'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_signals_archived FROM del;

  RETURN QUERY SELECT v_signals_raw, v_signals_dismissed, v_profiles, v_signals_archived;
END;
$$;

COMMENT ON FUNCTION public.cleanup_prospect_retention IS
  'Nettoyage quotidien : raw>14j sans profil, dismissed>30j, profils soft-del>30j, archived>60j.';

-- =============================================================================
-- Fix signatures RPC d'enrichissement : préfixe `out_` sur les OUT params
-- =============================================================================
-- jay-reach avait extrait la 1re version de claim/complete_enrichment_item
-- (RETURNS item_id/signal_id/attempts) mais PAS le fix d'ambiguïté du source
-- (20260424200000). Or enrich-company (déployé) lit out_item_id/out_signal_id/
-- out_attempts (claim) et out_job_id/out_remaining (complete). Conséquence :
-- claimRow.out_signal_id = undefined -> worker enrichit le signal "undefined",
-- complete_enrichment_item perd p_item_id -> item bloqué en 'processing'.
--
-- On porte ici le fix source : OUT params préfixés `out_`.
-- =============================================================================

DROP FUNCTION IF EXISTS claim_next_enrichment_item(uuid);
DROP FUNCTION IF EXISTS complete_enrichment_item(uuid, boolean, text);

CREATE OR REPLACE FUNCTION claim_next_enrichment_item(p_job_id uuid)
RETURNS TABLE (out_item_id uuid, out_signal_id uuid, out_attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_signal_id uuid;
  v_attempts int;
BEGIN
  WITH next_item AS (
    SELECT id
    FROM prospect_enrichment_job_items
    WHERE job_id = p_job_id AND status = 'pending'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE prospect_enrichment_job_items AS item
  SET
    status = 'processing',
    claimed_at = now(),
    attempts = item.attempts + 1
  FROM next_item
  WHERE item.id = next_item.id
  RETURNING item.id, item.signal_id, item.attempts
  INTO v_item_id, v_signal_id, v_attempts;

  IF v_item_id IS NOT NULL THEN
    UPDATE prospect_enrichment_jobs
    SET status = 'running', updated_at = now()
    WHERE id = p_job_id AND status = 'pending';

    RETURN QUERY SELECT v_item_id, v_signal_id, v_attempts;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_next_enrichment_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_enrichment_item(uuid) TO service_role;

CREATE OR REPLACE FUNCTION complete_enrichment_item(
  p_item_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS TABLE (out_job_id uuid, out_remaining int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_job_id uuid;
  v_remaining int;
BEGIN
  UPDATE prospect_enrichment_job_items
  SET
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    error = p_error,
    completed_at = now()
  WHERE id = p_item_id AND status = 'processing'
  RETURNING prospect_enrichment_job_items.job_id INTO v_job_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE prospect_enrichment_jobs
  SET
    completed = completed + CASE WHEN p_success THEN 1 ELSE 0 END,
    failed = failed + CASE WHEN p_success THEN 0 ELSE 1 END,
    updated_at = now()
  WHERE id = v_job_id;

  SELECT COUNT(*) INTO v_remaining
  FROM prospect_enrichment_job_items
  WHERE job_id = v_job_id AND status IN ('pending','processing');

  IF v_remaining = 0 THEN
    UPDATE prospect_enrichment_jobs
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = v_job_id AND status = 'running';
  END IF;

  RETURN QUERY SELECT v_job_id, v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION complete_enrichment_item(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_enrichment_item(uuid, boolean, text) TO service_role;

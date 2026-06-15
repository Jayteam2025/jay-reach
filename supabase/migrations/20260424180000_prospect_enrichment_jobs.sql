-- Prospection : queue d'enrichissement backend.
--
-- Remplace la queue navigateur (prospect-enrichment-queue.ts) qui etait
-- fragile : tab en arriere-plan → throttling Chrome, fermeture → queue perdue,
-- JWT expire → erreurs en cascade. On passe sur un modele persistant avec
-- workers auto-propages via pg_net.
--
-- Pattern : l'UI cree un job + items, puis lance `concurrency` workers
-- initiaux via pg_net. Chaque worker (= une invocation de enrich-company)
-- claim le prochain item via SKIP LOCKED, l'enrichit, update le progress,
-- et re-fire un worker via pg_net avant de rendre la main. Le chain
-- continue tant qu'il reste des items, sans depasser la limite Supabase de
-- 200s par invocation.

-- =============================================================================
-- Job = un batch d'enrichissement demande par un admin
-- =============================================================================
CREATE TABLE prospect_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  concurrency int NOT NULL DEFAULT 5 CHECK (concurrency BETWEEN 1 AND 10),
  total int NOT NULL DEFAULT 0,
  completed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX prospect_enrichment_jobs_user_created_idx
  ON prospect_enrichment_jobs (user_id, created_at DESC);
CREATE INDEX prospect_enrichment_jobs_status_idx
  ON prospect_enrichment_jobs (status) WHERE status IN ('pending','running');

-- =============================================================================
-- Item = un signal a enrichir dans un job
-- =============================================================================
CREATE TABLE prospect_enrichment_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES prospect_enrichment_jobs(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES prospect_signals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, signal_id)
);

CREATE INDEX prospect_enrichment_job_items_job_status_idx
  ON prospect_enrichment_job_items (job_id, status);
CREATE INDEX prospect_enrichment_job_items_pending_idx
  ON prospect_enrichment_job_items (job_id, created_at) WHERE status = 'pending';

-- =============================================================================
-- RLS : lecture admin-only (prospection = outil interne)
-- =============================================================================
ALTER TABLE prospect_enrichment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_enrichment_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read own jobs" ON prospect_enrichment_jobs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin read own job items" ON prospect_enrichment_job_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prospect_enrichment_jobs j
      WHERE j.id = job_id AND j.user_id = auth.uid()
    )
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated : seules les
-- edge functions en service_role manipulent les rows. Cote UI on ne lit
-- que le progress.

-- =============================================================================
-- RPC : claim atomique du prochain item a enrichir
--
-- FOR UPDATE SKIP LOCKED garantit que N workers qui tournent en parallele
-- ne piocheront jamais le meme item. On marque l'item 'processing' et on
-- incremente attempts dans la meme transaction.
-- =============================================================================
CREATE OR REPLACE FUNCTION claim_next_enrichment_item(p_job_id uuid)
RETURNS TABLE (item_id uuid, signal_id uuid, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_signal_id uuid;
  v_attempts int;
BEGIN
  -- Pick + lock en une transaction pour garantir qu'un seul worker attrape l'item
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
    -- Premier item pris → le job passe en 'running' (idempotent)
    UPDATE prospect_enrichment_jobs
    SET status = 'running', updated_at = now()
    WHERE id = p_job_id AND status = 'pending';

    RETURN QUERY SELECT v_item_id, v_signal_id, v_attempts;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_next_enrichment_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_enrichment_item(uuid) TO service_role;

-- =============================================================================
-- RPC : marque un item termine + update progress du job
--
-- Si c'etait le dernier item pending OU processing, marque le job completed.
-- =============================================================================
CREATE OR REPLACE FUNCTION complete_enrichment_item(
  p_item_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS TABLE (job_id uuid, remaining int) -- remaining = pending + processing
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
    -- Item deja completed (race) → no-op
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

-- =============================================================================
-- RPC : dispatch d'un worker via pg_net (DISABLED for OSS Phase 1)
--
-- Requires pg_net extension which is optional. Can be re-enabled later
-- when the OSS project needs async worker dispatch.
-- =============================================================================
-- DISABLED: spawn_enrichment_worker function requires pg_net extension
-- See edge function enrich-company for async worker dispatch instead

-- =============================================================================
-- Realtime : permettre au client de s'abonner aux updates du job
-- (alternative au polling ; au cas ou on en aurait besoin plus tard)
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE prospect_enrichment_jobs;

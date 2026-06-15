-- ============================================================================
-- Prospect Batches tracking + polling cron + weekly recap email cron
--
-- 1. prospect_batches : tracke les batches Anthropic async soumis par le cron
-- 2. poll-prospect-batches (toutes les 10 min) : finalise les batches termines
-- 3. prospect-weekly-recap (lundi 07:00 UTC = 09:00 Paris ete) : email Alex
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table prospect_batches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.prospect_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL,
    batch_id TEXT NOT NULL UNIQUE,
    batch_type TEXT NOT NULL CHECK (batch_type IN ('scoring', 'linkedin_message')),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'ended', 'failed')),
    total INT,
    processed_count INT,
    failed_count INT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    last_polled_at TIMESTAMPTZ,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_prospect_batches_status ON public.prospect_batches(status) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_prospect_batches_run_id ON public.prospect_batches(run_id);

ALTER TABLE public.prospect_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view prospect_batches" ON public.prospect_batches;
CREATE POLICY "Admins can view prospect_batches"
    ON public.prospect_batches FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

COMMENT ON TABLE public.prospect_batches IS 'Tracking des batches Anthropic async (scoring + messages). Le cron poll-prospect-batches finalise les batches termines.';

-- ---------------------------------------------------------------------------
-- Cron: poll-prospect-batches (toutes les 10 minutes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_poll_prospect_batches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cron_secret TEXT;
    v_pending_count INT;
    v_request_id BIGINT;
BEGIN
    -- Skip si aucun batch en cours (evite appels inutiles)
    SELECT COUNT(*) INTO v_pending_count
    FROM public.prospect_batches
    WHERE status = 'in_progress';

    IF v_pending_count = 0 THEN
        RETURN;
    END IF;

    BEGIN
        SELECT decrypted_secret INTO v_cron_secret
        FROM vault.decrypted_secrets
        WHERE name = 'CRON_SECRET'
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        v_cron_secret := NULL;
    END;

    IF v_cron_secret IS NULL OR v_cron_secret = '' THEN
        RAISE WARNING 'CRON_SECRET not configured in Vault. Skipping poll-prospect-batches.';
        RETURN;
    END IF;

    SELECT net.http_post(
        url := 'https://kaysiemagfaqmvusyfav.supabase.co/functions/v1/poll-prospect-batches',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_cron_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    ) INTO v_request_id;

    RAISE NOTICE 'poll-prospect-batches called (% pending), request_id: %', v_pending_count, v_request_id;
END;
$$;

COMMENT ON FUNCTION public.call_poll_prospect_batches IS 'Wrapper pour poll-prospect-batches via pg_net. Appele par pg_cron toutes les 10 min.';

-- Cron scheduling removed for OSS (can be scheduled manually or via edge function)
-- DO $$
-- BEGIN
--     PERFORM cron.unschedule('poll-prospect-batches');
-- EXCEPTION WHEN OTHERS THEN
--     NULL;
-- END $$;
--
-- SELECT cron.schedule(
--     'poll-prospect-batches',
--     '*/10 * * * *',
--     $$SELECT public.call_poll_prospect_batches()$$
-- );

-- ---------------------------------------------------------------------------
-- Cron: prospect-weekly-recap (lundi 07:00 UTC = 09:00 Paris ete, 08:00 hiver)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_prospect_weekly_recap()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cron_secret TEXT;
    v_request_id BIGINT;
BEGIN
    BEGIN
        SELECT decrypted_secret INTO v_cron_secret
        FROM vault.decrypted_secrets
        WHERE name = 'CRON_SECRET'
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        v_cron_secret := NULL;
    END;

    IF v_cron_secret IS NULL OR v_cron_secret = '' THEN
        RAISE WARNING 'CRON_SECRET not configured in Vault. Skipping prospect-weekly-recap.';
        RETURN;
    END IF;

    SELECT net.http_post(
        url := 'https://kaysiemagfaqmvusyfav.supabase.co/functions/v1/prospect-weekly-recap',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_cron_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    ) INTO v_request_id;

    RAISE NOTICE 'prospect-weekly-recap called, request_id: %', v_request_id;
END;
$$;

COMMENT ON FUNCTION public.call_prospect_weekly_recap IS 'Wrapper pour prospect-weekly-recap via pg_net. Appele par pg_cron lundi 07:00 UTC.';

-- Cron scheduling removed for OSS (can be scheduled manually or via edge function)
-- DO $$
-- BEGIN
--     PERFORM cron.unschedule('prospect-weekly-recap');
-- EXCEPTION WHEN OTHERS THEN
--     NULL;
-- END $$;
--
-- SELECT cron.schedule(
--     'prospect-weekly-recap',
--     '0 7 * * 1',
--     $$SELECT public.call_prospect_weekly_recap()$$
-- );

-- ---------------------------------------------------------------------------
-- Trigger manuel de test
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_poll_prospect_batches_manual()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.call_poll_prospect_batches();
    RETURN 'poll-prospect-batches triggered.';
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_prospect_weekly_recap_manual()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.call_prospect_weekly_recap();
    RETURN 'prospect-weekly-recap triggered.';
END;
$$;

DO $$
BEGIN
    RAISE NOTICE 'Migration: prospect_batches + polling (*/10) + recap (lundi 07:00 UTC)';
END $$;

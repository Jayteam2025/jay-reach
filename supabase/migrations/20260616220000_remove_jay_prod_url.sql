-- ============================================================================
-- Remove hardcoded prod URL from crons
--
-- Context: A previous deployment's Supabase project ref was hardcoded
-- in call_poll_prospect_batches() and call_prospect_weekly_recap() functions.
-- These crons are not scheduled in OSS self-host → replace with no-op to remove
-- external dependency on the original infrastructure.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Disable call_poll_prospect_batches (was calling Jay prod)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_poll_prospect_batches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE NOTICE 'call_poll_prospect_batches: cron disabled in OSS self-host. This function is a no-op. To enable, configure a polling mechanism pointing to your own Edge Function instance.';
END;
$$;

COMMENT ON FUNCTION public.call_poll_prospect_batches IS 'DISABLED in OSS: Was calling Jay prod. Can be re-implemented to call your own edge function endpoint (not hardcoded). Wrapped for backwards compatibility.';

-- ---------------------------------------------------------------------------
-- Disable call_prospect_weekly_recap (was calling Jay prod)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_prospect_weekly_recap()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE NOTICE 'call_prospect_weekly_recap: cron disabled in OSS self-host. This function is a no-op. To enable, configure a weekly recap mechanism pointing to your own Edge Function instance.';
END;
$$;

COMMENT ON FUNCTION public.call_prospect_weekly_recap IS 'DISABLED in OSS: Was calling Jay prod. Can be re-implemented to call your own edge function endpoint (not hardcoded). Wrapped for backwards compatibility.';

-- ---------------------------------------------------------------------------
-- Migration marker
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE 'Migration: remove_jay_prod_url — disabled crons calling hardcoded Jay prod URLs (backwards-compat no-op wrappers)';
END $$;

-- =============================================================================
-- Colonnes prospect_profiles manquantes (écrites par l'enrichissement)
-- =============================================================================
-- enrich-company insère les contacts FullEnrich avec email_source +
-- deliverability_* + more_available_counts, mais jay-reach avait raté les ALTER
-- source correspondants (20260511140000 email_source, 20260611110000 deliverability,
-- 20260421140000 more_available). D'où l'échec d'insert :
--   "Could not find the 'email_source' column of 'prospect_profiles'".
-- Backfills source (depuis bouncer_*) omis : table vide sur l'OSS.
-- =============================================================================

-- email_source : origine de l'email stocké (boucle d'apprentissage bounce).
ALTER TABLE public.prospect_profiles
  ADD COLUMN IF NOT EXISTS email_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospect_profiles_email_source_check'
  ) THEN
    ALTER TABLE public.prospect_profiles
      ADD CONSTRAINT prospect_profiles_email_source_check
      CHECK (email_source IS NULL OR email_source = ANY (
        ARRAY['fullenrich'::text, 'deduced'::text, 'crm'::text, 'manual'::text, 'unknown'::text, 'imported'::text]
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prospect_profiles_email_source_idx
  ON public.prospect_profiles(email_source) WHERE email_source IS NOT NULL;

-- Verdict de délivrabilité (validateur Bouncer/Reoon/demo).
ALTER TABLE public.prospect_profiles
  ADD COLUMN IF NOT EXISTS deliverability_status TEXT
    CHECK (deliverability_status IN ('valid','invalid','risky','disposable','role','unknown')),
  ADD COLUMN IF NOT EXISTS deliverability_reason TEXT,
  ADD COLUMN IF NOT EXISTS deliverability_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deliverability_provider TEXT
    CHECK (deliverability_provider IS NULL OR deliverability_provider IN ('bouncer','reoon','demo'));

CREATE INDEX IF NOT EXISTS idx_prospect_profiles_deliverability_valid
  ON public.prospect_profiles (workspace_id)
  WHERE deliverability_status = 'valid';

-- Compteurs "more available" FullEnrich (pour la pagination des contacts).
ALTER TABLE public.prospect_profiles
  ADD COLUMN IF NOT EXISTS more_available_counts JSONB DEFAULT NULL;

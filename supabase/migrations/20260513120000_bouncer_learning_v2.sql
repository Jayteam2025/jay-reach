-- Bouncer integration + bounce learning loop V2
-- Drop la V1 minimale (20260511150000_bounce_learning.sql) et la remplace
-- par une infrastructure complete avec audit log dedie + tier progressif.

-- === 1. DROP V1 ============================================================
-- DROP defensif : staging n'a pas smartlead_events. Wrap dans DO block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'smartlead_events') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS smartlead_reply_marks_verified ON smartlead_events';
  END IF;
END $$;

DROP FUNCTION IF EXISTS mark_email_verified_on_reply();
DROP FUNCTION IF EXISTS get_effective_tier(TEXT);
DROP VIEW IF EXISTS domain_email_pattern_empirical;

-- === 2. Colonnes Bouncer sur prospect_profiles =============================
ALTER TABLE prospect_profiles
  ADD COLUMN IF NOT EXISTS bouncer_status TEXT,
  ADD COLUMN IF NOT EXISTS bouncer_reason TEXT,
  ADD COLUMN IF NOT EXISTS bouncer_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smartlead_push_decision TEXT,
  ADD COLUMN IF NOT EXISTS smartlead_push_reason TEXT;

ALTER TABLE prospect_profiles
  DROP CONSTRAINT IF EXISTS prospect_profiles_bouncer_status_check;
ALTER TABLE prospect_profiles
  ADD CONSTRAINT prospect_profiles_bouncer_status_check
  CHECK (bouncer_status IS NULL OR bouncer_status = ANY (ARRAY[
    'valid','invalid','risky','disposable','role','unknown'
  ]));

CREATE INDEX IF NOT EXISTS idx_prospect_profiles_bouncer_pending
  ON prospect_profiles(created_at)
  WHERE bouncer_status IS NULL
    AND email IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN prospect_profiles.bouncer_status IS
  'Verdict Bouncer email verification : valid|invalid|risky|disposable|role|unknown. NULL = pas encore verifie.';

-- === 3. Table bouncer_jobs : tracking batchs en cours =======================
CREATE TABLE IF NOT EXISTS bouncer_jobs (
  job_id TEXT PRIMARY KEY,
  profile_ids UUID[] NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  webhook_payload JSONB,
  CONSTRAINT bouncer_jobs_status_check
    CHECK (status IN ('pending','completed','failed','timeout'))
);

CREATE INDEX IF NOT EXISTS idx_bouncer_jobs_pending
  ON bouncer_jobs(sent_at) WHERE status = 'pending';

ALTER TABLE bouncer_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE bouncer_jobs IS
  'Tracking des batchs Bouncer en cours. Le service appelle Bouncer puis attend le webhook avec le job_id.';

-- === 4. Table pattern_audit_events : coeur du learning =====================
CREATE TABLE IF NOT EXISTS pattern_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospect_profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  email_source TEXT NOT NULL CHECK (email_source IN ('deduced','fullenrich','crm','manual','unknown')),
  pattern_id TEXT,
  pattern_confidence NUMERIC,
  fullenrich_status TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'generated','bouncer_verdict','sent','bounced','replied','opened'
  )),
  event_value TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_audit_domain_pattern_event
  ON pattern_audit_events(domain, pattern_id, event_type);
CREATE INDEX IF NOT EXISTS idx_pattern_audit_domain_fe_status_event
  ON pattern_audit_events(domain, fullenrich_status, event_type);
CREATE INDEX IF NOT EXISTS idx_pattern_audit_prospect
  ON pattern_audit_events(prospect_id);

ALTER TABLE pattern_audit_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pattern_audit_events IS
  'Trace fine de chaque email : qui l''a genere, quel verdict Bouncer, quel resultat Smartlead. Alimente bounce-learning.';

-- === 5. Compteurs empiriques sur domain_email_patterns =====================
ALTER TABLE domain_email_patterns
  ADD COLUMN IF NOT EXISTS empirical_sends INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS empirical_bounces INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS empirical_replies INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS downgraded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS downgraded_reason TEXT;

-- === 6. Trigger : reply marque email comme verified (port V1 -> V2) =========
CREATE OR REPLACE FUNCTION mark_email_verified_on_reply_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.event_type = 'replied' AND NEW.prospect_id IS NOT NULL THEN
    UPDATE prospect_profiles
    SET email_validation_status = 'verified',
        updated_at = NOW()
    WHERE id = NEW.prospect_id
      AND email IS NOT NULL
      AND email_validation_status IN ('deduced_high','deduced_unverified','unverified');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pattern_audit_reply_marks_verified ON pattern_audit_events;

CREATE TRIGGER pattern_audit_reply_marks_verified
AFTER INSERT ON pattern_audit_events
FOR EACH ROW
WHEN (NEW.event_type = 'replied')
EXECUTE FUNCTION mark_email_verified_on_reply_v2();

COMMENT ON FUNCTION mark_email_verified_on_reply_v2() IS
  'V2 : declenche sur pattern_audit_events au lieu de smartlead_events. Une reply = email verifie.';

-- === 7. Fonction get_effective_tier V2 =====================================
-- Nouvelle logique :
--   - Lit empirical_sends / empirical_bounces de domain_email_patterns
--     (peuples par bounce-learning cron)
--   - Si downgraded_at NOT NULL : tier degrade deja applique sur stored_tier
--   - Si manual_override : toujours le tier stocke
--   - Le downgrade est fait par bounce-learning cron (UPDATE tier+downgraded_at en meme temps)
CREATE OR REPLACE FUNCTION get_effective_tier(domain_param TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  stored_tier TEXT;
  stored_source TEXT;
BEGIN
  SELECT tier, source INTO stored_tier, stored_source
  FROM domain_email_patterns
  WHERE domain = domain_param;

  IF stored_tier IS NULL THEN
    RETURN NULL;
  END IF;

  -- manual_override : toujours intouchable
  IF stored_source = 'manual_override' THEN
    RETURN stored_tier;
  END IF;

  -- Sinon retourne le tier stocke (deja degrade par bounce-learning si applicable)
  RETURN stored_tier;
END;
$$;

COMMENT ON FUNCTION get_effective_tier(TEXT) IS
  'V2 : retourne le tier stocke. Le bounce-learning cron est responsable de UPDATE tier + downgraded_at en meme temps. La lecture est simple.';

-- =============================================================================
-- Comblement des objets DB référencés par le code mais absents du schéma OSS
-- =============================================================================
-- Audit de complétude Jay -> jay-reach : plusieurs tables et RPC référencés par
-- le front et les edge functions actives n'avaient jamais été extraits (détectables
-- uniquement au runtime, comme workspace_brand/dashboard auparavant).
--
-- Inclus ici (vrais oublis, sans dépendance pg_net ni sous-système extension) :
--   Tables : enrichment_cache, pending_fullenrich_bulks, api_rate_limits,
--            edge_function_logs, validation_errors, email_connections,
--            pending_emails, smartlead_campaigns
--   Index  : idx_prospect_profiles_company_trgm (GIN pg_trgm, pour la recherche)
--   RPC    : search_prospect_companies, compute_pattern_empirical,
--            kill_enrichment_job, increment_crm_detection_attempts
--
-- VOLONTAIREMENT EXCLUS (décisions architecturales, pas des oublis) :
--   - spawn_enrichment_worker / spawn_bouncer_sweep : dispatch worker via pg_net,
--     désactivé en Phase 1 OSS (cf. 20260424180000) ; les edge fns dégradent
--     proprement (log + continue) en leur absence.
--   - Sous-système extension Chrome (extension_action_queue, detect_user_crm_type,
--     validate/deactivate_extension_token) : reconstruction multi-patch + non
--     exercé par le funnel web. À traiter en lot dédié.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Index GIN trigram pour search_prospect_companies (pg_trgm déjà activé)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prospect_profiles_company_trgm
  ON public.prospect_profiles USING GIN (company_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- enrichment_cache : cache des appels API coûteux (FullEnrich company resolve…)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_type TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(cache_type, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_lookup ON enrichment_cache(cache_type, cache_key);
ALTER TABLE enrichment_cache ENABLE ROW LEVEL SECURITY;
-- Service role only (cache backend) : pas de policy = pas d'accès client.

-- -----------------------------------------------------------------------------
-- pending_fullenrich_bulks : cache des payloads webhook FullEnrich (anti rate-limit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_fullenrich_bulks (
  enrichment_id TEXT PRIMARY KEY,
  webhook_payload JSONB,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_fullenrich_bulks_received
  ON public.pending_fullenrich_bulks(received_at)
  WHERE received_at IS NOT NULL;
ALTER TABLE public.pending_fullenrich_bulks ENABLE ROW LEVEL SECURITY;
-- Service role only : pas de policy = pas d'accès client.

-- -----------------------------------------------------------------------------
-- api_rate_limits : rate limiting des edge functions (imports, webhooks publics)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  endpoint_category TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_identifier_type CHECK (identifier_type IN ('ip', 'user')),
  CONSTRAINT valid_endpoint_category CHECK (endpoint_category IN ('oauth', 'webhook', 'admin', 'api', 'public'))
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_lookup
  ON api_rate_limits(identifier, endpoint_category, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_cleanup
  ON api_rate_limits(window_start);
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read rate limits" ON api_rate_limits;
CREATE POLICY "Admins can read rate limits"
  ON api_rate_limits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
-- Le service role bypass RLS (insert/update par les edge fns).
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM api_rate_limits WHERE window_start < NOW() - INTERVAL '5 minutes';
END;
$$;
COMMENT ON TABLE api_rate_limits IS 'Rate limiting pour les Edge Functions';

-- -----------------------------------------------------------------------------
-- edge_function_logs : logs applicatifs des edge functions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edge_function_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'warning')),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_user_id ON edge_function_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_function_name ON edge_function_logs(function_name);
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_created_at ON edge_function_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_function_logs_user_function ON edge_function_logs(user_id, function_name, created_at DESC);
ALTER TABLE edge_function_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own edge function logs" ON edge_function_logs;
DROP POLICY IF EXISTS "Service role can insert edge function logs" ON edge_function_logs;
DROP POLICY IF EXISTS "Admins can view all edge function logs" ON edge_function_logs;
CREATE POLICY "Users can view their own edge function logs"
  ON edge_function_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert edge function logs"
  ON edge_function_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view all edge function logs"
  ON edge_function_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
COMMENT ON TABLE edge_function_logs IS 'Logs des edge functions pour debug et monitoring';

-- -----------------------------------------------------------------------------
-- validation_errors : logs des erreurs de validation Zod (mode warn, non bloquant)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  errors JSONB NOT NULL,
  received_data TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_errors_function_name ON validation_errors(function_name);
CREATE INDEX IF NOT EXISTS idx_validation_errors_created_at ON validation_errors(created_at DESC);
ALTER TABLE validation_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read validation errors" ON validation_errors;
CREATE POLICY "Admins can read validation errors"
  ON validation_errors FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE OR REPLACE FUNCTION cleanup_old_validation_errors()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM validation_errors WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;
COMMENT ON TABLE validation_errors IS 'Logs des erreurs de validation Zod (mode warn).';

-- -----------------------------------------------------------------------------
-- email_connections + pending_emails : envoi email direct SMTP (smtp-send-email)
-- NOTE : les PART 3/4 du source (migration de données depuis pending_google_emails
-- / pending_microsoft_emails) sont VOLONTAIREMENT omises — ces tables legacy
-- n'existent pas dans l'OSS.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('ovh', 'infomaniak', 'proton', 'yahoo', 'custom')),
  email TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'oauth2')),
  encrypted_password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_secure BOOLEAN NOT NULL DEFAULT true,
  caldav_url TEXT,
  caldav_enabled BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_email_connections_user_id ON email_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_email_connections_provider ON email_connections(provider);
ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own email connections" ON email_connections;
DROP POLICY IF EXISTS "Users can insert their own email connections" ON email_connections;
DROP POLICY IF EXISTS "Users can update their own email connections" ON email_connections;
DROP POLICY IF EXISTS "Users can delete their own email connections" ON email_connections;
CREATE POLICY "Users can view their own email connections"
  ON email_connections FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can insert their own email connections"
  ON email_connections FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update their own email connections"
  ON email_connections FOR UPDATE USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete their own email connections"
  ON email_connections FOR DELETE USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION update_email_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS email_connections_updated_at ON email_connections;
CREATE TRIGGER email_connections_updated_at
  BEFORE UPDATE ON email_connections
  FOR EACH ROW EXECUTE FUNCTION update_email_connections_updated_at();

CREATE OR REPLACE FUNCTION ensure_single_default_email()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE email_connections SET is_default = false
    WHERE user_id = NEW.user_id AND id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS email_connections_single_default ON email_connections;
CREATE TRIGGER email_connections_single_default
  BEFORE INSERT OR UPDATE ON email_connections
  FOR EACH ROW WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_email();
COMMENT ON TABLE email_connections IS 'Connexions email SMTP/OAuth (OVH, Infomaniak, Proton, Yahoo, custom).';

CREATE TABLE IF NOT EXISTS pending_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'ovh', 'infomaniak', 'proton', 'yahoo', 'custom')),
  from_email TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'sent', 'cancelled', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_emails_user_id ON pending_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_emails_status ON pending_emails(status);
CREATE INDEX IF NOT EXISTS idx_pending_emails_user_status ON pending_emails(user_id, status);
ALTER TABLE pending_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pending_emails_select" ON pending_emails;
DROP POLICY IF EXISTS "pending_emails_insert" ON pending_emails;
DROP POLICY IF EXISTS "pending_emails_update" ON pending_emails;
DROP POLICY IF EXISTS "pending_emails_delete" ON pending_emails;
CREATE POLICY "pending_emails_select" ON pending_emails FOR SELECT
  USING ((SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) = user_id);
CREATE POLICY "pending_emails_insert" ON pending_emails FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) = user_id);
CREATE POLICY "pending_emails_update" ON pending_emails FOR UPDATE
  USING ((SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) = user_id);
CREATE POLICY "pending_emails_delete" ON pending_emails FOR DELETE
  USING ((SELECT auth.role()) = 'service_role' OR (SELECT auth.uid()) = user_id);
CREATE OR REPLACE FUNCTION cleanup_old_pending_emails()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM pending_emails
  WHERE status IN ('sent', 'cancelled', 'failed') AND created_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
COMMENT ON TABLE pending_emails IS 'File des emails en attente de validation avant envoi.';

-- -----------------------------------------------------------------------------
-- smartlead_campaigns : mapping persona -> campagne Smartlead (provider outreach)
-- CREATE final propre (l'OSS démarre vide, pas de backfill Jay-spécifique).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartlead_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES public.icp_personas(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  target_category TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_smartlead_campaigns_workspace_persona
  ON public.smartlead_campaigns(workspace_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_smartlead_campaigns_workspace
  ON public.smartlead_campaigns(workspace_id);
ALTER TABLE public.smartlead_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "smartlead_campaigns_select_viewer" ON public.smartlead_campaigns;
DROP POLICY IF EXISTS "smartlead_campaigns_insert_admin" ON public.smartlead_campaigns;
DROP POLICY IF EXISTS "smartlead_campaigns_update_admin" ON public.smartlead_campaigns;
DROP POLICY IF EXISTS "smartlead_campaigns_delete_admin" ON public.smartlead_campaigns;
CREATE POLICY "smartlead_campaigns_select_viewer" ON public.smartlead_campaigns FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('viewer')));
CREATE POLICY "smartlead_campaigns_insert_admin" ON public.smartlead_campaigns FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));
CREATE POLICY "smartlead_campaigns_update_admin" ON public.smartlead_campaigns FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));
CREATE POLICY "smartlead_campaigns_delete_admin" ON public.smartlead_campaigns FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM public.user_workspaces('admin')));
DROP TRIGGER IF EXISTS smartlead_campaigns_updated_at ON public.smartlead_campaigns;
CREATE TRIGGER smartlead_campaigns_updated_at
  BEFORE UPDATE ON public.smartlead_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
COMMENT ON TABLE public.smartlead_campaigns IS 'Mapping persona -> campagne Smartlead par workspace.';

-- -----------------------------------------------------------------------------
-- RPC : search_prospect_companies (recherche fuzzy pg_trgm, barre entreprises)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_prospect_companies(
  p_query TEXT,
  p_limit INT DEFAULT 20
) RETURNS JSONB
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
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

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

  WITH matches AS (
    SELECT DISTINCT ON (company_group_id)
      company_group_id,
      company_name,
      similarity(company_name, p_query) AS sim,
      MAX(created_at) OVER (PARTITION BY company_group_id) AS max_created_at,
      COUNT(*) OVER (PARTITION BY company_group_id) AS profile_count
    FROM public.prospect_profiles
    WHERE workspace_id = v_workspace_id
      AND deleted_at IS NULL
      AND company_group_id IS NOT NULL
      AND company_name % p_query
    ORDER BY company_group_id, similarity(company_name, p_query) DESC
  )
  SELECT jsonb_agg(jsonb_build_object(
    'company_group_id', company_group_id,
    'company_name', company_name,
    'similarity', sim,
    'profile_count', profile_count,
    'max_created_at', max_created_at
  ) ORDER BY sim DESC, company_name)
  INTO v_result
  FROM matches
  LIMIT p_limit;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_prospect_companies(TEXT, INT) TO authenticated;
COMMENT ON FUNCTION public.search_prospect_companies IS
  'Recherche fuzzy server-side via pg_trgm sur prospect_profiles.company_name.';

-- -----------------------------------------------------------------------------
-- RPC : compute_pattern_empirical (bounce-learning, agrégat pattern_audit_events)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_pattern_empirical(window_days INT DEFAULT 30)
RETURNS TABLE (
  domain TEXT,
  pattern_id TEXT,
  sends INT,
  bounces INT,
  replies INT,
  bouncer_total INT,
  bouncer_invalids INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH evt AS (
    SELECT *
    FROM pattern_audit_events
    WHERE occurred_at > NOW() - (window_days || ' days')::INTERVAL
      AND email_source = 'deduced'
  ),
  email_to_pattern AS (
    SELECT DISTINCT ON (email)
      email,
      pattern_id
    FROM evt
    WHERE event_type = 'generated' AND pattern_id IS NOT NULL
    ORDER BY email, occurred_at DESC
  )
  SELECT
    evt.domain,
    COALESCE(evt.pattern_id, ep.pattern_id) AS pattern_id,
    COUNT(*) FILTER (WHERE evt.event_type = 'sent')::INT             AS sends,
    COUNT(*) FILTER (WHERE evt.event_type = 'bounced')::INT          AS bounces,
    COUNT(*) FILTER (WHERE evt.event_type = 'replied')::INT          AS replies,
    COUNT(*) FILTER (WHERE evt.event_type = 'bouncer_verdict')::INT  AS bouncer_total,
    COUNT(*) FILTER (WHERE evt.event_type = 'bouncer_verdict' AND evt.event_value = 'invalid')::INT AS bouncer_invalids
  FROM evt
  LEFT JOIN email_to_pattern ep USING (email)
  WHERE COALESCE(evt.pattern_id, ep.pattern_id) IS NOT NULL
  GROUP BY evt.domain, COALESCE(evt.pattern_id, ep.pattern_id);
$$;
COMMENT ON FUNCTION compute_pattern_empirical(INT) IS
  'Agrège pattern_audit_events sur N jours pour bounce-learning (inclut signal Bouncer).';

-- -----------------------------------------------------------------------------
-- RPC : kill_enrichment_job (arrêt net d'un job sur épuisement crédits FullEnrich)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kill_enrichment_job(
  p_job_id uuid,
  p_reason text
)
RETURNS TABLE (killed_items int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_killed int;
BEGIN
  UPDATE prospect_enrichment_job_items
  SET status = 'failed',
      error = p_reason,
      completed_at = now()
  WHERE job_id = p_job_id AND status IN ('pending', 'processing');
  GET DIAGNOSTICS v_killed = ROW_COUNT;

  UPDATE prospect_enrichment_jobs
  SET status = 'failed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_job_id AND status IN ('pending', 'running');

  RETURN QUERY SELECT v_killed;
END;
$$;
REVOKE ALL ON FUNCTION kill_enrichment_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION kill_enrichment_job(uuid, text) TO service_role;

-- -----------------------------------------------------------------------------
-- RPC : increment_crm_detection_attempts (compteur atomique, detect-crm)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_crm_detection_attempts(p_company_group_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE prospect_crm_detections
  SET attempts = attempts + 1
  WHERE company_group_id = p_company_group_id;
$$;
COMMENT ON FUNCTION increment_crm_detection_attempts IS 'Increment atomique du compteur attempts (detect-crm).';

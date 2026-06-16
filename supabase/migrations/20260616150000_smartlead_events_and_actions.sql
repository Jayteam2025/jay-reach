-- =============================================================================
-- smartlead_events (boucle de tracking Smartlead) + élargissement prospect_actions
-- =============================================================================
-- Le webhook public smartlead-webhook reçoit les events Smartlead (sent / opened /
-- replied / bounced / clicked), les stocke bruts dans smartlead_events, et les
-- mirroir dans pattern_audit_events (qui alimente bounce-learning V2) + met à jour
-- prospect_messages sur reply. Sans la table smartlead_events, le webhook lève une
-- erreur sur sa 1re écriture (dans le try) et n'atteint jamais le mirror utile.
--
-- En parallèle : jay-reach avait raté la migration 20260505100000 du source qui
-- élargit les CHECK de prospect_actions. Le code (useProspectActions.ts +
-- smartlead-webhook) écrit action_type='sent'/'download' et channel='postal_letter'
-- /'social_dm', silencieusement rejetés par la contrainte d'origine ('copy','open').
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Élargissement des CHECK de prospect_actions (port de 20260505100000 source)
-- -----------------------------------------------------------------------------
ALTER TABLE public.prospect_actions
  DROP CONSTRAINT IF EXISTS prospect_actions_action_type_check;
ALTER TABLE public.prospect_actions
  ADD CONSTRAINT prospect_actions_action_type_check
  CHECK (action_type = ANY (ARRAY['copy', 'open', 'sent', 'download']));

ALTER TABLE public.prospect_actions
  DROP CONSTRAINT IF EXISTS prospect_actions_channel_check;
ALTER TABLE public.prospect_actions
  ADD CONSTRAINT prospect_actions_channel_check
  CHECK (channel = ANY (ARRAY['email', 'linkedin', 'instagram', 'tiktok', 'letter', 'postal_letter', 'social_dm']));

-- -----------------------------------------------------------------------------
-- smartlead_events : stockage brut des events Smartlead (audit / debug)
-- En V2, bounce-learning lit pattern_audit_events ; smartlead_events reste un
-- journal brut écrit par le webhook (service role). Pas de consommateur direct.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartlead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES public.prospect_profiles(id) ON DELETE SET NULL,
  lead_email TEXT,
  campaign_id BIGINT,
  event_type TEXT NOT NULL,
  subject TEXT,
  message TEXT,
  email_account TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_smartlead_events_prospect ON public.smartlead_events(prospect_id);
CREATE INDEX IF NOT EXISTS idx_smartlead_events_type ON public.smartlead_events(event_type);
CREATE INDEX IF NOT EXISTS idx_smartlead_events_created ON public.smartlead_events(created_at DESC);
ALTER TABLE public.smartlead_events ENABLE ROW LEVEL SECURITY;
-- Service role only (écrit par smartlead-webhook) : pas de policy = pas d'accès client.
COMMENT ON TABLE public.smartlead_events IS
  'Journal brut des events Smartlead (sent/opened/replied/bounced/clicked) reçus par le webhook.';

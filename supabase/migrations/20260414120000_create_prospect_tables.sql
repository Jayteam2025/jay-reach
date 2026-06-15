-- Migration pour le système de prospection (CRM interne)
-- Date: 2026-04-14
-- Crée 8 tables pour la gestion de prospects, signaux, séquences et suivi
-- Toutes les tables ont des politiques RLS admin-only avec UUIDs hardcodés

-- ========================================
-- 1. TABLE: prospect_profiles (créé en premier)
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  company_name TEXT,
  company_siren TEXT,
  company_size TEXT,
  company_sector TEXT,
  company_city TEXT,
  target_category TEXT NOT NULL CHECK (target_category IN ('director', 'field_sales', 'hr')),
  linkedin_url TEXT CHECK (linkedin_url IS NULL OR linkedin_url ~ '^https://(www\.)?linkedin\.com/'),
  instagram_url TEXT CHECK (instagram_url IS NULL OR instagram_url ~ '^https://(www\.)?instagram\.com/'),
  tiktok_url TEXT CHECK (tiktok_url IS NULL OR tiktok_url ~ '^https://(www\.)?tiktok\.com/'),
  twitter_url TEXT CHECK (twitter_url IS NULL OR twitter_url ~ '^https://(www\.)?(twitter|x)\.com/'),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'in_sequence', 'replied', 'meeting_booked', 'converted', 'lost')),
  qualification_score INT DEFAULT 0 CHECK (qualification_score >= 0 AND qualification_score <= 100),
  enrichment_data JSONB DEFAULT '{}',
  source_signal_id UUID,
  company_group_id UUID,
  email_validation_status TEXT DEFAULT 'unverified' CHECK (email_validation_status IN ('unverified', 'valid', 'bounced')),
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_profiles_status ON prospect_profiles(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_profiles_company_siren ON prospect_profiles(company_siren);
CREATE INDEX IF NOT EXISTS idx_prospect_profiles_target_status ON prospect_profiles(target_category, status);
CREATE INDEX IF NOT EXISTS idx_prospect_profiles_company_group_id ON prospect_profiles(company_group_id);

-- ========================================
-- 2. TABLE: prospect_signals
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL CHECK (signal_type IN ('job_posting', 'linkedin_activity', 'direct_listing', 'inbound_visit', 'social_interaction', 'google_alert')),
  source TEXT NOT NULL,
  source_url TEXT,
  raw_content TEXT,
  extracted_data JSONB DEFAULT '{}',
  company_name TEXT,
  matched_prospect_id UUID REFERENCES prospect_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'raw' CHECK (status IN ('raw', 'matched', 'dismissed')),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_signal_source UNIQUE(source, source_url)
);

CREATE INDEX IF NOT EXISTS idx_prospect_signals_status_detected ON prospect_signals(status, detected_at);
CREATE INDEX IF NOT EXISTS idx_prospect_signals_source ON prospect_signals(source);
CREATE INDEX IF NOT EXISTS idx_prospect_signals_company_name ON prospect_signals(company_name);

-- FK retroactive (après création de prospect_signals)
ALTER TABLE prospect_profiles ADD CONSTRAINT fk_source_signal
  FOREIGN KEY (source_signal_id) REFERENCES prospect_signals(id) ON DELETE SET NULL;

-- ========================================
-- 3. TABLE: prospect_sequences
-- ========================================
-- (créé avant prospect_messages)
CREATE TABLE IF NOT EXISTS prospect_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  target_category TEXT NOT NULL CHECK (target_category IN ('director', 'field_sales', 'hr')),
  steps JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  auto_send BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_sequences_active ON prospect_sequences(is_active);

-- ========================================
-- 4. TABLE: prospect_messages
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospect_profiles(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES prospect_sequences(id) ON DELETE SET NULL,
  step_position INT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'linkedin', 'instagram', 'tiktok', 'letter')),
  subject TEXT,
  body TEXT NOT NULL,
  icebreaker TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'replied', 'bounced')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  llm_model TEXT,
  llm_prompt_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_messages_prospect_sequence ON prospect_messages(prospect_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_prospect_messages_status_scheduled ON prospect_messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_prospect_messages_channel ON prospect_messages(channel);

-- ========================================
-- 5. TABLE: prospect_icp_filters
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_icp_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  criteria JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 6. TABLE: prospect_templates
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT,
  target_category TEXT,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  available_variables JSONB DEFAULT '[]',
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 7. TABLE: prospect_scraping_logs
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_scraping_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'rate_limited', 'blocked', 'error', 'timeout')),
  http_status INT,
  error_message TEXT,
  duration_ms INT,
  results_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_scraping_logs_source_created ON prospect_scraping_logs(source, created_at);
CREATE INDEX IF NOT EXISTS idx_prospect_scraping_logs_status ON prospect_scraping_logs(status);

-- ========================================
-- 8. TABLE: prospect_data_access_logs
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_data_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('view', 'export', 'delete', 'email_send', 'approve_message')),
  prospect_ids UUID[] NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_data_access_logs_admin ON prospect_data_access_logs(admin_id, created_at);

-- ========================================
-- ENABLE RLS ON ALL TABLES
-- ========================================
ALTER TABLE prospect_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_icp_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_scraping_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_data_access_logs ENABLE ROW LEVEL SECURITY;

-- ========================================
-- RLS POLICIES (ADMIN-ONLY avec UUIDs hardcodés)
-- ========================================
DO $$
DECLARE
  admin_uuids UUID[] := ARRAY[
    'aa853541-4146-47b4-bd64-b035f28a41b3'::UUID,  -- Alexandre De Clercq
    'c4b3c69b-a862-431c-a9f8-00c2fead350a'::UUID,  -- Jean-Baptiste Renart
    'f2db7bdb-1067-412d-a3ee-f0d101fd3b99'::UUID   -- Jay service
  ];
  table_name TEXT;
BEGIN
  -- Créer les politiques pour chaque table
  FOREACH table_name IN ARRAY ARRAY['prospect_signals', 'prospect_profiles', 'prospect_sequences',
                                       'prospect_messages', 'prospect_icp_filters', 'prospect_templates',
                                       'prospect_scraping_logs', 'prospect_data_access_logs']
  LOOP
    -- SELECT
    EXECUTE format('
      CREATE POLICY "Admin only select" ON %I FOR SELECT
      USING (auth.uid() = ANY(%L))',
      table_name, admin_uuids);

    -- INSERT
    EXECUTE format('
      CREATE POLICY "Admin only insert" ON %I FOR INSERT
      WITH CHECK (auth.uid() = ANY(%L))',
      table_name, admin_uuids);

    -- UPDATE
    EXECUTE format('
      CREATE POLICY "Admin only update" ON %I FOR UPDATE
      USING (auth.uid() = ANY(%L))
      WITH CHECK (auth.uid() = ANY(%L))',
      table_name, admin_uuids, admin_uuids);

    -- DELETE
    EXECUTE format('
      CREATE POLICY "Admin only delete" ON %I FOR DELETE
      USING (auth.uid() = ANY(%L))',
      table_name, admin_uuids);
  END LOOP;
END $$;

-- ========================================
-- TRIGGERS for updated_at auto-update
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prospect_profiles_updated_at
  BEFORE UPDATE ON prospect_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_prospect_sequences_updated_at
  BEFORE UPDATE ON prospect_sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_prospect_messages_updated_at
  BEFORE UPDATE ON prospect_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_prospect_icp_filters_updated_at
  BEFORE UPDATE ON prospect_icp_filters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_prospect_templates_updated_at
  BEFORE UPDATE ON prospect_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- SEED DATA: Default Sequences
-- ========================================
INSERT INTO prospect_sequences (name, description, target_category, steps, is_active, auto_send)
VALUES
  (
    'Directeur Commercial',
    'Séquence 4 étapes pour directeurs commerciaux',
    'director',
    '[
      {"step": 1, "day": 0, "channel": "email", "type": "introduction"},
      {"step": 2, "day": 3, "channel": "linkedin", "type": "connection_request"},
      {"step": 3, "day": 7, "channel": "email", "type": "follow_up"},
      {"step": 4, "day": 14, "channel": "letter", "type": "physical_contact"}
    ]'::JSONB,
    true,
    false
  ),
  (
    'Commercial Terrain',
    'Séquence 5 étapes pour commerciaux terrain',
    'field_sales',
    '[
      {"step": 1, "day": 0, "channel": "email", "type": "introduction"},
      {"step": 2, "day": 2, "channel": "linkedin", "type": "connection_request"},
      {"step": 3, "day": 5, "channel": "email", "type": "follow_up"},
      {"step": 4, "day": 8, "channel": "instagram", "type": "social_engagement"},
      {"step": 5, "day": 12, "channel": "email", "type": "final_follow_up"}
    ]'::JSONB,
    true,
    false
  ),
  (
    'RH - Signal Recrutement',
    'Séquence 1 étape pour signaux de recrutement RH',
    'hr',
    '[
      {"step": 1, "day": 0, "channel": "email", "type": "opportunity_alert"}
    ]'::JSONB,
    true,
    false
  )
ON CONFLICT DO NOTHING;

-- ========================================
-- COMMENTS
-- ========================================
COMMENT ON TABLE prospect_signals IS 'Signaux bruts détectés (job postings, activités LinkedIn, etc.)';
COMMENT ON TABLE prospect_profiles IS 'Profils de prospects avec données enrichies et statut';
COMMENT ON TABLE prospect_sequences IS 'Configurations de séquences multi-canaux';
COMMENT ON TABLE prospect_messages IS 'Messages générés pour les prospects';
COMMENT ON TABLE prospect_icp_filters IS 'Critères configurables pour le filtrage ICP';
COMMENT ON TABLE prospect_templates IS 'Templates de messages avec prompts LLM';
COMMENT ON TABLE prospect_scraping_logs IS 'Logs de santé du scraping';
COMMENT ON TABLE prospect_data_access_logs IS 'Audit trail RGPD des accès aux données';

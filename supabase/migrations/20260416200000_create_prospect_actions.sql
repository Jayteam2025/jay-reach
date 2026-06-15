-- Track user actions on prospect profiles (copy message, open LinkedIn, etc.)
-- Used for progress tracking in Entreprises fiche view

CREATE TABLE IF NOT EXISTS prospect_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospect_profiles(id) ON DELETE CASCADE,
  company_group_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('copy', 'open')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'linkedin', 'instagram', 'tiktok', 'letter')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_actions_company ON prospect_actions(company_group_id);
CREATE INDEX idx_prospect_actions_prospect ON prospect_actions(prospect_id);

-- RLS: admin only (same pattern as other prospect tables)
ALTER TABLE prospect_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on prospect_actions"
  ON prospect_actions
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role = 'admin'
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role = 'admin'
    )
  );

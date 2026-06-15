-- Détection automatique du CRM utilisé par chaque entreprise prospectée.
-- Une ligne par company_group_id (pas de FK : companies sont virtuelles).
CREATE TABLE IF NOT EXISTS prospect_crm_detections (
  company_group_id UUID PRIMARY KEY,

  domain TEXT,
  domain_source TEXT CHECK (domain_source IN ('fullenrich', 'brave', 'manual')),

  crm_name TEXT,
  crm_confidence TEXT NOT NULL DEFAULT 'pending'
    CHECK (crm_confidence IN ('high', 'medium', 'low', 'none', 'pending')),

  detection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (detection_status IN ('pending', 'completed', 'failed')),
  error TEXT,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts <= 10),

  crm_signals JSONB NOT NULL DEFAULT '{}'::jsonb,

  detected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_crm_detections_status
  ON prospect_crm_detections(detection_status)
  WHERE detection_status != 'completed';

CREATE INDEX IF NOT EXISTS idx_prospect_crm_detections_crm_name
  ON prospect_crm_detections(crm_name)
  WHERE crm_name IS NOT NULL;

CREATE TRIGGER set_prospect_crm_detections_updated_at
  BEFORE UPDATE ON prospect_crm_detections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE prospect_crm_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on prospect_crm_detections"
  ON prospect_crm_detections
  FOR ALL
  USING (auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM profiles WHERE role = 'admin'));

COMMENT ON TABLE prospect_crm_detections IS 'Détection auto du CRM par entreprise, mise à jour async par l''edge function detect-crm. Accès admin uniquement.';

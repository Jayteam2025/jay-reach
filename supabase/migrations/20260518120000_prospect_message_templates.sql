-- ============================================================================
-- prospect_message_templates : éditeur de templates depuis l'UI Config
--
-- Source de vérité pour les templates de messages prospection.
-- Remplace les 8 fonctions hardcodées dans prospect-renderer.ts.
-- Édition admin-only via appartenance au workspace (rôle admin/owner).
-- ============================================================================

CREATE TABLE IF NOT EXISTS prospect_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_category text NOT NULL CHECK (target_category IN ('hr', 'director', 'field_sales')),
  channel text NOT NULL CHECK (channel IN ('email', 'linkedin', 'postal_letter', 'social_dm')),
  subject_variants text[] NOT NULL DEFAULT '{}',
  opener_variants text[] NOT NULL DEFAULT '{}',
  body text NOT NULL,
  icebreaker_template text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE (target_category, channel)
);

CREATE INDEX IF NOT EXISTS idx_prospect_message_templates_active
  ON prospect_message_templates(target_category, channel)
  WHERE is_active = true;

ALTER TABLE prospect_message_templates ENABLE ROW LEVEL SECURITY;

-- Lecture pour tous les membres du workspace
-- Note: workspace_id est ajoute par 20260520100000_workspace_jay_and_backfill_prospect_tables.sql
-- Cette politique sera appliquee apres que la colonne existe.
-- Pendant cette migration, RLS est actif mais sans policies (universe readable jusqu'a 20260520110000)

-- Temporaire: lecture universel (avant l'ajout de workspace_id)
DROP POLICY IF EXISTS "prospect_message_templates_select" ON prospect_message_templates;
CREATE POLICY "prospect_message_templates_select"
  ON prospect_message_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- Insert admin-only: temporaire (avant workspace_id)
DROP POLICY IF EXISTS "prospect_message_templates_insert_admin" ON prospect_message_templates;
CREATE POLICY "prospect_message_templates_insert_admin"
  ON prospect_message_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Update admin-only: temporaire (avant workspace_id)
DROP POLICY IF EXISTS "prospect_message_templates_update_admin" ON prospect_message_templates;
CREATE POLICY "prospect_message_templates_update_admin"
  ON prospect_message_templates
  FOR UPDATE
  TO authenticated
  USING (true);

-- Auto-update updated_at + bump version sur UPDATE
CREATE OR REPLACE FUNCTION prospect_message_templates_bump_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF (
    NEW.subject_variants IS DISTINCT FROM OLD.subject_variants
    OR NEW.opener_variants IS DISTINCT FROM OLD.opener_variants
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.icebreaker_template IS DISTINCT FROM OLD.icebreaker_template
  ) THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_message_templates_bump_version ON prospect_message_templates;
CREATE TRIGGER trg_prospect_message_templates_bump_version
  BEFORE UPDATE ON prospect_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION prospect_message_templates_bump_version();

-- Traçabilité des messages générés
ALTER TABLE prospect_messages
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES prospect_message_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version int;

CREATE INDEX IF NOT EXISTS idx_prospect_messages_template
  ON prospect_messages(template_id, template_version);

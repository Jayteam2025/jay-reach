-- Migration pour l'import de fichiers de prospection
-- Date: 2026-05-13
-- Description: Table prospect_imports + extensions prospect_signals pour traquer
-- les boites importees via fichier (XLSX/CSV/PDF/DOCX/texte colle).
-- Active pg_trgm pour la barre de recherche entreprises.
-- Spec: docs/superpowers/specs/2026-05-12-prospection-file-upload-import-design.md

-- ========================================
-- 1. Extension pg_trgm pour recherche fuzzy
-- ========================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ========================================
-- 2. Table prospect_imports (audit + metadata des imports)
-- ========================================
CREATE TABLE IF NOT EXISTS prospect_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),

  -- Metadonnees source
  source_filename TEXT NOT NULL,
  source_format TEXT NOT NULL CHECK (source_format IN ('xlsx', 'xls', 'csv', 'tsv', 'pdf', 'docx', 'text_paste')),
  source_file_size_bytes INT,
  source_file_hash TEXT,
  source_sheet_name TEXT,

  -- Mapping IA applique (audit + re-process futur)
  mapping_used JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Totaux
  rows_detected INT NOT NULL DEFAULT 0,
  rows_imported INT NOT NULL DEFAULT 0,
  rows_skipped_duplicate INT NOT NULL DEFAULT 0,
  rows_skipped_user INT NOT NULL DEFAULT 0,
  rows_failed INT NOT NULL DEFAULT 0,

  -- Hooks d'extension V2 (Storage Supabase, vides en V1)
  source_file_path TEXT,
  extracted_text_cache TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prospect_imports_user_created ON prospect_imports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_imports_hash ON prospect_imports(source_file_hash) WHERE source_file_hash IS NOT NULL;

-- ========================================
-- 3. Extensions de prospect_signals
-- ========================================
-- Attention: la colonne `source` existe deja (TEXT NOT NULL) avec une autre semantique
-- (linkedin/indeed/...). On utilise donc `acquisition_method` pour ne pas casser.

ALTER TABLE prospect_signals
  ADD COLUMN IF NOT EXISTS acquisition_method TEXT NOT NULL DEFAULT 'scrape'
    CHECK (acquisition_method IN ('scrape', 'file_upload', 'manual')),
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES prospect_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_metadata JSONB,
  ADD COLUMN IF NOT EXISTS do_not_outreach_reasons TEXT[];

CREATE INDEX IF NOT EXISTS idx_prospect_signals_acquisition_method
  ON prospect_signals(acquisition_method);

CREATE INDEX IF NOT EXISTS idx_prospect_signals_import_id
  ON prospect_signals(import_id) WHERE import_id IS NOT NULL;

-- ========================================
-- 4. Index trigram pour recherche entreprises
-- ========================================
-- Concatene company_name + contact + ville pour matcher sur tous les champs.
-- gin_trgm_ops permet le fuzzy matching tolerant aux fautes de frappe.
CREATE INDEX IF NOT EXISTS idx_prospect_signals_search_trgm
  ON prospect_signals USING gin (
    (
      COALESCE(company_name, '') || ' ' ||
      COALESCE(extracted_data->>'contact_full', '') || ' ' ||
      COALESCE(extracted_data->>'contact_first_name', '') || ' ' ||
      COALESCE(extracted_data->>'contact_last_name', '') || ' ' ||
      COALESCE(extracted_data->>'city', '')
    ) gin_trgm_ops
  );

-- ========================================
-- 5. Extension du CHECK de prospect_data_access_logs.action
-- ========================================
-- Ajoute 'import_create' et 'import_commit' pour tracer les imports
ALTER TABLE prospect_data_access_logs
  DROP CONSTRAINT IF EXISTS prospect_data_access_logs_action_check;

ALTER TABLE prospect_data_access_logs
  ADD CONSTRAINT prospect_data_access_logs_action_check
    CHECK (action IN (
      'view', 'export', 'delete', 'email_send', 'approve_message',
      'import_create', 'import_commit'
    ));

-- ========================================
-- 6. RLS sur prospect_imports
-- ========================================
-- Suit le pattern existant des autres tables prospect_* (UUIDs hardcodes).
-- Coherent avec migration 20260414120000_create_prospect_tables.sql.
ALTER TABLE prospect_imports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  admin_uuids UUID[] := ARRAY[
    '00000000-0000-0000-0000-0000000000a1'::UUID,  -- admin (policies héritées, remplacées par les RLS workspace plus loin)
    '00000000-0000-0000-0000-0000000000a2'::UUID,
    '00000000-0000-0000-0000-0000000000a3'::UUID
  ];
BEGIN
  EXECUTE format('
    CREATE POLICY "Admin only select" ON prospect_imports FOR SELECT
    USING (auth.uid() = ANY(%L))', admin_uuids);

  EXECUTE format('
    CREATE POLICY "Admin only insert" ON prospect_imports FOR INSERT
    WITH CHECK (auth.uid() = ANY(%L) AND user_id = auth.uid())', admin_uuids);

  EXECUTE format('
    CREATE POLICY "Admin only update" ON prospect_imports FOR UPDATE
    USING (auth.uid() = ANY(%L) AND user_id = auth.uid())
    WITH CHECK (auth.uid() = ANY(%L) AND user_id = auth.uid())', admin_uuids, admin_uuids);

  EXECUTE format('
    CREATE POLICY "Admin only delete" ON prospect_imports FOR DELETE
    USING (auth.uid() = ANY(%L) AND user_id = auth.uid())', admin_uuids);
END $$;

-- ========================================
-- 7. Commentaires de documentation
-- ========================================
COMMENT ON TABLE prospect_imports IS 'Audit des imports de fichiers de prospection (admin-only). Chaque ligne du fichier devient un prospect_signals avec acquisition_method=file_upload.';
COMMENT ON COLUMN prospect_imports.mapping_used IS 'JSON du mapping IA applique : { header_row_index, columns: { raison_sociale: ''B'', ... }, multi_contact_cells: [...] }';
COMMENT ON COLUMN prospect_imports.source_file_path IS 'Hook V2 : chemin Supabase Storage du fichier source. NULL en V1.';
COMMENT ON COLUMN prospect_imports.extracted_text_cache IS 'Hook V2 : cache du texte extrait par OCR/parsing. NULL en V1.';

COMMENT ON COLUMN prospect_signals.acquisition_method IS 'scrape (default, signaux scrapes FT/Adzuna/Apify), file_upload (imports admin), manual (saisie manuelle future)';
COMMENT ON COLUMN prospect_signals.import_id IS 'FK vers prospect_imports si la boite vient d''un fichier. NULL pour les scrap.';
COMMENT ON COLUMN prospect_signals.imported_metadata IS 'Donnees du fichier non standards : tier, angle, notes, fit_score, specialite, ca_estime, fdv_size, etc.';
COMMENT ON COLUMN prospect_signals.do_not_outreach_reasons IS 'Raisons pour ne pas relancer ce contact (ex: linkedin_invitation_sent, active_conversation, already_connected, outreach_sent). NULL = OK pour outreach.';

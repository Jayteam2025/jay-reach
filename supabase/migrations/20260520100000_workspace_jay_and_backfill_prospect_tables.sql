-- =============================================================================
-- Jay Reach OSS — workspace_id sur 18 tables prospection
-- Ajoute la colonne workspace_id a toutes les tables prospection existantes.
-- Note: en OSS fresh DB, il n'y a aucune row a backfill (la trigger
-- handle_new_user() crée le workspace automatiquement pour chaque nouveau user).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD COLUMN workspace_id (nullable d'abord) sur les tables prospection
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  tables CONSTANT TEXT[] := ARRAY[
    'prospect_actions',
    'prospect_batches',
    'prospect_crm_detections',
    'prospect_data_access_logs',
    'prospect_enrichment_job_items',
    'prospect_enrichment_jobs',
    'prospect_icp_filters',
    'prospect_imports',
    'prospect_letters',
    'prospect_message_templates',
    'prospect_messages',
    'prospect_profiles',
    'prospect_scraping_logs',
    'prospect_sequences',
    'prospect_signals',
    'prospect_templates',
    'prospection_email_queue',
    'prospection_mailboxes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE',
        t
      );
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table public.% does not exist (skipping workspace_id column)', t;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. SET NOT NULL sur workspace_id (pas de backfill en fresh DB)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  tables CONSTANT TEXT[] := ARRAY[
    'prospect_actions',
    'prospect_batches',
    'prospect_crm_detections',
    'prospect_data_access_logs',
    'prospect_enrichment_job_items',
    'prospect_enrichment_jobs',
    'prospect_icp_filters',
    'prospect_imports',
    'prospect_letters',
    'prospect_message_templates',
    'prospect_messages',
    'prospect_profiles',
    'prospect_scraping_logs',
    'prospect_sequences',
    'prospect_signals',
    'prospect_templates',
    'prospection_email_queue',
    'prospection_mailboxes'
  ];
  v_null_count INT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      -- Check if column exists and if there are NULLs
      EXECUTE format(
        'SELECT COUNT(*) FROM public.%I WHERE workspace_id IS NULL',
        t
      ) INTO v_null_count;

      IF v_null_count > 0 THEN
        RAISE NOTICE 'Table public.% has % NULL workspace_id rows (skipping SET NOT NULL)', t, v_null_count;
      ELSE
        EXECUTE format(
          'ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL',
          t
        );
        RAISE NOTICE 'Set workspace_id NOT NULL on public.%', t;
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE 'Table/column public.%.workspace_id does not exist (skipping SET NOT NULL)', t;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes composites perf sur les queries chaudes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospect_profiles_workspace_status
  ON public.prospect_profiles(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prospect_signals_workspace_status
  ON public.prospect_signals(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prospect_messages_workspace_status
  ON public.prospect_messages(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prospect_actions_workspace_prospect
  ON public.prospect_actions(workspace_id, prospect_id);

CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_jobs_workspace_status
  ON public.prospect_enrichment_jobs(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_job_items_workspace_status
  ON public.prospect_enrichment_job_items(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_prospect_imports_workspace_user
  ON public.prospect_imports(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_prospect_crm_detections_workspace
  ON public.prospect_crm_detections(workspace_id);

-- Indexes skipped for non-existent tables (prospection_email_queue, etc.)
-- They will be created when the tables are added in future migrations

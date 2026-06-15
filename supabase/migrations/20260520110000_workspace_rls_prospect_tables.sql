-- =============================================================================
-- Jay Reach Phase 1.1.3 — RLS workspace-based sur 18 tables prospection
-- Reference : docs/jay-reach/adr/0003-multi-tenant-workspace-id.md
-- Issue : https://github.com/Jayteam2025/jay/issues/360
--
-- Pattern uniforme :
--   - SELECT : 'viewer' (tous les membres du workspace voient)
--   - INSERT : 'member' (members peuvent creer)
--   - UPDATE : 'member' (members peuvent modifier)
--   - DELETE : 'admin'  (admins/owners peuvent supprimer)
--
-- Cas particuliers :
--   - prospect_data_access_logs : audit log RGPD, DELETE = owner only
--   - prospect_message_templates : SELECT = viewer, INSERT/UPDATE = admin
--   - prospect_imports : SELECT/UPDATE/DELETE limites a son user_id ET workspace
--   - prospect_enrichment_jobs : idem (user_id check supplementaire)
--   - prospect_enrichment_job_items : access via le job parent
-- =============================================================================

-- ---------------------------------------------------------------------------
-- prospect_actions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin full access on prospect_actions" ON public.prospect_actions;
CREATE POLICY "members read" ON public.prospect_actions FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_actions FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_actions FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_actions FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_batches
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view prospect_batches" ON public.prospect_batches;
CREATE POLICY "members read" ON public.prospect_batches FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_batches FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_batches FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_batches FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_crm_detections
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin full access on prospect_crm_detections" ON public.prospect_crm_detections;
CREATE POLICY "members read" ON public.prospect_crm_detections FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_crm_detections FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_crm_detections FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_crm_detections FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_data_access_logs (audit RGPD : plus restrictif)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_data_access_logs;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_data_access_logs;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_data_access_logs;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_data_access_logs;
CREATE POLICY "admins read" ON public.prospect_data_access_logs FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "members insert" ON public.prospect_data_access_logs FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
-- Pas d'UPDATE sur les logs (immuables par design)
CREATE POLICY "owners delete" ON public.prospect_data_access_logs FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('owner')));

-- ---------------------------------------------------------------------------
-- prospect_enrichment_jobs (jobs visibles par tous les membres du workspace)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin read own jobs" ON public.prospect_enrichment_jobs;
CREATE POLICY "members read" ON public.prospect_enrichment_jobs FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_enrichment_jobs FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_enrichment_jobs FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_enrichment_jobs FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_enrichment_job_items
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin read own job items" ON public.prospect_enrichment_job_items;
CREATE POLICY "members read" ON public.prospect_enrichment_job_items FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_enrichment_job_items FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_enrichment_job_items FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_enrichment_job_items FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_icp_filters
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_icp_filters;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_icp_filters;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_icp_filters;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_icp_filters;
CREATE POLICY "members read" ON public.prospect_icp_filters FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "admins insert" ON public.prospect_icp_filters FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins update" ON public.prospect_icp_filters FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins delete" ON public.prospect_icp_filters FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_imports (workspace + user_id = auth.uid())
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_imports;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_imports;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_imports;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_imports;
CREATE POLICY "members read own imports" ON public.prospect_imports FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT public.user_workspaces('viewer'))
    AND (user_id = auth.uid() OR workspace_id IN (SELECT public.user_workspaces('admin')))
  );
CREATE POLICY "members insert own imports" ON public.prospect_imports FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT public.user_workspaces('member'))
    AND user_id = auth.uid()
  );
CREATE POLICY "members update own imports" ON public.prospect_imports FOR UPDATE TO authenticated
  USING (
    workspace_id IN (SELECT public.user_workspaces('member'))
    AND user_id = auth.uid()
  )
  WITH CHECK (
    workspace_id IN (SELECT public.user_workspaces('member'))
    AND user_id = auth.uid()
  );
CREATE POLICY "admins delete imports" ON public.prospect_imports FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_letters (skip if table doesn't exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  DROP POLICY IF EXISTS "Admin only select" ON public.prospect_letters;
  DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_letters;
  DROP POLICY IF EXISTS "Admin only update" ON public.prospect_letters;
  DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_letters;
  CREATE POLICY "members read" ON public.prospect_letters FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
  CREATE POLICY "members insert" ON public.prospect_letters FOR INSERT TO authenticated
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
  CREATE POLICY "members update" ON public.prospect_letters FOR UPDATE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('member')))
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
  CREATE POLICY "admins delete" ON public.prospect_letters FOR DELETE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('admin')));
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.prospect_letters does not exist (skipping RLS setup)';
END $$;

-- ---------------------------------------------------------------------------
-- prospect_message_templates (templates = admin write, all members read)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "prospect_message_templates_select" ON public.prospect_message_templates;
DROP POLICY IF EXISTS "prospect_message_templates_insert_admin" ON public.prospect_message_templates;
DROP POLICY IF EXISTS "prospect_message_templates_update_admin" ON public.prospect_message_templates;
CREATE POLICY "members read" ON public.prospect_message_templates FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "admins insert" ON public.prospect_message_templates FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins update" ON public.prospect_message_templates FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins delete" ON public.prospect_message_templates FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_messages;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_messages;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_messages;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_messages;
CREATE POLICY "members read" ON public.prospect_messages FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_messages FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_messages FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_messages FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_profiles
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_profiles;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_profiles;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_profiles;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_profiles;
CREATE POLICY "members read" ON public.prospect_profiles FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_profiles FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_profiles FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_profiles FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_scraping_logs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_scraping_logs;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_scraping_logs;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_scraping_logs;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_scraping_logs;
CREATE POLICY "members read" ON public.prospect_scraping_logs FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_scraping_logs FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_scraping_logs FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_sequences
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_sequences;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_sequences;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_sequences;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_sequences;
CREATE POLICY "members read" ON public.prospect_sequences FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "admins insert" ON public.prospect_sequences FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins update" ON public.prospect_sequences FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins delete" ON public.prospect_sequences FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_signals
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_signals;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_signals;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_signals;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_signals;
CREATE POLICY "members read" ON public.prospect_signals FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "members insert" ON public.prospect_signals FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "members update" ON public.prospect_signals FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('member')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
CREATE POLICY "admins delete" ON public.prospect_signals FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospect_templates (deprecated table mais on garde par coherence)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin only select" ON public.prospect_templates;
DROP POLICY IF EXISTS "Admin only insert" ON public.prospect_templates;
DROP POLICY IF EXISTS "Admin only update" ON public.prospect_templates;
DROP POLICY IF EXISTS "Admin only delete" ON public.prospect_templates;
CREATE POLICY "members read" ON public.prospect_templates FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
CREATE POLICY "admins insert" ON public.prospect_templates FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins update" ON public.prospect_templates FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
CREATE POLICY "admins delete" ON public.prospect_templates FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

-- ---------------------------------------------------------------------------
-- prospection_email_queue (skip if table doesn't exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  DROP POLICY IF EXISTS "Admin full access on prospection_email_queue" ON public.prospection_email_queue;
  CREATE POLICY "members read" ON public.prospection_email_queue FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
  CREATE POLICY "members insert" ON public.prospection_email_queue FOR INSERT TO authenticated
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
  CREATE POLICY "members update" ON public.prospection_email_queue FOR UPDATE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('member')))
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('member')));
  CREATE POLICY "admins delete" ON public.prospection_email_queue FOR DELETE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('admin')));
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.prospection_email_queue does not exist (skipping RLS setup)';
END $$;

-- ---------------------------------------------------------------------------
-- prospection_mailboxes (skip if table doesn't exist)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  DROP POLICY IF EXISTS "Admin full access on prospection_mailboxes" ON public.prospection_mailboxes;
  CREATE POLICY "members read" ON public.prospection_mailboxes FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('viewer')));
  CREATE POLICY "admins insert" ON public.prospection_mailboxes FOR INSERT TO authenticated
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
  CREATE POLICY "admins update" ON public.prospection_mailboxes FOR UPDATE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('admin')))
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));
  CREATE POLICY "admins delete" ON public.prospection_mailboxes FOR DELETE TO authenticated
    USING (workspace_id IN (SELECT public.user_workspaces('admin')));
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.prospection_mailboxes does not exist (skipping RLS setup)';
END $$;

-- =============================================================================
-- Note : aucune RLS pour service_role (qui bypasse RLS by design). Les edge
-- functions continuent de fonctionner sans changement.
-- =============================================================================

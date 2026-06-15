-- Phase 1.2.3.d : multi-tenant smartlead_campaigns + persona_id
-- Oublie en 1.1.2 (workspace_id) et 1.2.2 (persona_id), corrige ici.
--
-- - Ajoute workspace_id (NOT NULL apres backfill Jay)
-- - Ajoute persona_id (FK icp_personas, nullable pendant transition)
-- - Backfill persona_id via mapping target_category -> persona slug
-- - UNIQUE (workspace_id, persona_id) pour empecher les doublons par persona
-- - RLS workspace-based

DO $$
DECLARE
  jay_workspace UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- 1. Ajout des colonnes (nullable au depart)
  ALTER TABLE public.smartlead_campaigns
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.icp_personas(id) ON DELETE SET NULL;

  -- 2. Backfill workspace_id : tout sur Jay
  UPDATE public.smartlead_campaigns
  SET workspace_id = jay_workspace
  WHERE workspace_id IS NULL;

  -- 3. Backfill persona_id via mapping target_category -> persona slug
  UPDATE public.smartlead_campaigns sc
  SET persona_id = ip.id
  FROM public.icp_personas ip
  WHERE sc.persona_id IS NULL
    AND ip.workspace_id = jay_workspace
    AND (
      (sc.target_category = 'hr' AND ip.slug = 'hr-decision-maker')
      OR (sc.target_category = 'director' AND ip.slug = 'director')
      OR (sc.target_category = 'field_sales' AND ip.slug = 'field-sales')
    );

  -- 4. workspace_id devient obligatoire
  ALTER TABLE public.smartlead_campaigns
    ALTER COLUMN workspace_id SET NOT NULL;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.smartlead_campaigns does not exist (skipping workspace/persona setup)';
END $$;

-- 5-7. Indexes, constraints and RLS (skip if table doesn't exist)
DO $$
BEGIN
  -- Index composites
  CREATE INDEX IF NOT EXISTS idx_smartlead_campaigns_workspace_persona
    ON public.smartlead_campaigns(workspace_id, persona_id)
    WHERE persona_id IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_smartlead_campaigns_workspace_target_cat
    ON public.smartlead_campaigns(workspace_id, target_category)
    WHERE target_category IS NOT NULL;

  -- Drop old constraint if exists
  BEGIN
    ALTER TABLE public.smartlead_campaigns
      DROP CONSTRAINT smartlead_campaigns_target_category_key;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Unique by persona
  CREATE UNIQUE INDEX IF NOT EXISTS uq_smartlead_campaigns_workspace_persona
    ON public.smartlead_campaigns(workspace_id, persona_id)
    WHERE persona_id IS NOT NULL;

  -- Unique by target_category (fallback)
  CREATE UNIQUE INDEX IF NOT EXISTS uq_smartlead_campaigns_workspace_target_cat
    ON public.smartlead_campaigns(workspace_id, target_category)
    WHERE target_category IS NOT NULL;

  -- RLS
  ALTER TABLE public.smartlead_campaigns ENABLE ROW LEVEL SECURITY;

  -- Drop old policies
  DECLARE pol_name TEXT;
  BEGIN
    FOR pol_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'smartlead_campaigns'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.smartlead_campaigns', pol_name);
    END LOOP;
  END;

  CREATE POLICY "smartlead_campaigns_select_viewer"
    ON public.smartlead_campaigns FOR SELECT
    USING (workspace_id IN (SELECT public.user_workspaces('viewer')));

  CREATE POLICY "smartlead_campaigns_insert_admin"
    ON public.smartlead_campaigns FOR INSERT
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

  CREATE POLICY "smartlead_campaigns_update_admin"
    ON public.smartlead_campaigns FOR UPDATE
    USING (workspace_id IN (SELECT public.user_workspaces('admin')))
    WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

  CREATE POLICY "smartlead_campaigns_delete_admin"
    ON public.smartlead_campaigns FOR DELETE
    USING (workspace_id IN (SELECT public.user_workspaces('admin')));
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.smartlead_campaigns does not exist (skipping indexes/RLS)';
END $$;

-- Jay Reach 1.4.2 : table workspace_providers generique (validator + enricher + outreach)
--
-- Remplace workspace_outreach_providers en couvrant les 3 categories de providers
-- prospection : outreach (Smartlead, Resend, MS Graph), validator (Bouncer),
-- enricher (FullEnrich). Permet a chaque org de configurer ses propres API keys.
--
-- Securite : les credentials sont stockes dans Supabase Vault et referencees
-- via config.api_key_vault_secret. Aucune cle en clair dans la DB.

CREATE TABLE IF NOT EXISTS public.workspace_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('outreach', 'validator', 'enricher')),
  provider_type TEXT NOT NULL,
  -- channel uniquement pertinent pour outreach (email, linkedin)
  channel TEXT NULL CHECK (channel IS NULL OR channel IN ('email', 'linkedin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- config shape :
  --   outreach Smartlead : { api_key_vault_secret: 'JAY_SMARTLEAD_API_KEY' }
  --   validator Bouncer : { api_key_vault_secret: 'JAY_BOUNCER_API_KEY' }
  --   enricher FullEnrich : { api_key_vault_secret: 'JAY_FULLENRICH_API_KEY' }
  --   plus extras specifiques au provider (audience_id Resend, sender_email MS, ...)
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul provider actif par (workspace, category, channel)
  -- channel NULL pour validator/enricher → contrainte d'unicite via coalesce
  UNIQUE (workspace_id, category, channel, is_active) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_workspace_providers_resolve
  ON public.workspace_providers(workspace_id, category, is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.workspace_providers_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_providers_updated_at ON public.workspace_providers;
CREATE TRIGGER workspace_providers_updated_at
  BEFORE UPDATE ON public.workspace_providers
  FOR EACH ROW EXECUTE FUNCTION public.workspace_providers_set_updated_at();

-- RLS workspace-based (meme pattern que workspace_outreach_providers)
ALTER TABLE public.workspace_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wp_select_member" ON public.workspace_providers;
CREATE POLICY "wp_select_member" ON public.workspace_providers
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces()));

DROP POLICY IF EXISTS "wp_insert_admin" ON public.workspace_providers;
CREATE POLICY "wp_insert_admin" ON public.workspace_providers
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

DROP POLICY IF EXISTS "wp_update_admin" ON public.workspace_providers;
CREATE POLICY "wp_update_admin" ON public.workspace_providers
  FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT public.user_workspaces('admin')));

DROP POLICY IF EXISTS "wp_delete_admin" ON public.workspace_providers;
CREATE POLICY "wp_delete_admin" ON public.workspace_providers
  FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.user_workspaces('admin')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_providers TO authenticated;

-- Migrate rows existantes de workspace_outreach_providers
-- vers workspace_providers avec category='outreach'.
-- (skip if table doesn't exist - fresh OSS install)
DO $$
BEGIN
  INSERT INTO public.workspace_providers (
    workspace_id, category, provider_type, channel, is_active, config, created_at, updated_at
  )
  SELECT
    workspace_id,
    'outreach' as category,
    provider_type,
    channel,
    is_active,
    config,
    created_at,
    updated_at
  FROM public.workspace_outreach_providers
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Table public.workspace_outreach_providers does not exist (skipping migration)';
END $$;

-- Campagnes éditables côté app (1 par persona) : nom + séquence (étapes/textes/délais) en JSONB.
-- L'envoi réel reste géré par Smartlead (mapping séparé dans smartlead_campaigns).
CREATE TABLE IF NOT EXISTS public.prospect_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES public.icp_personas(id) ON DELETE CASCADE,
  name text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, persona_id)
);

ALTER TABLE public.prospect_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY prospect_campaigns_select_viewer ON public.prospect_campaigns
  FOR SELECT USING (workspace_id IN (SELECT user_workspaces FROM user_workspaces('viewer')));
CREATE POLICY prospect_campaigns_insert_admin ON public.prospect_campaigns
  FOR INSERT WITH CHECK (workspace_id IN (SELECT user_workspaces FROM user_workspaces('admin')));
CREATE POLICY prospect_campaigns_update_admin ON public.prospect_campaigns
  FOR UPDATE USING (workspace_id IN (SELECT user_workspaces FROM user_workspaces('admin')))
  WITH CHECK (workspace_id IN (SELECT user_workspaces FROM user_workspaces('admin')));
CREATE POLICY prospect_campaigns_delete_admin ON public.prospect_campaigns
  FOR DELETE USING (workspace_id IN (SELECT user_workspaces FROM user_workspaces('admin')));

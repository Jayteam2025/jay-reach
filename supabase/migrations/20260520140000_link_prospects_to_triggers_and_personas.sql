-- =============================================================================
-- Jay Reach Phase 1.2.2 — Lier prospect_* aux signal_triggers et icp_personas
-- Reference : memoire jay-reach-icp-vs-triggers-model
-- Issue : https://github.com/Jayteam2025/jay/issues/362
--
-- Ajoute (purement additif, target_category reste pour compat) :
--   - prospect_signals.trigger_id     -> quel trigger a genere ce signal
--   - prospect_profiles.persona_id    -> persona du contact
--   - prospect_sequences.persona_id   -> persona cible de la sequence
--   - prospect_messages.persona_id    -> persona du destinataire
--   - prospect_message_templates.persona_id -> persona du template
--
-- Backfill : mapping target_category -> persona slug
--   - 'director'    -> persona 'director'
--   - 'field_sales' -> persona 'field-sales'
--   - 'hr'          -> persona 'hr-decision-maker'
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD COLUMN trigger_id sur prospect_signals (nullable, FK vers signal_triggers)
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_signals
  ADD COLUMN IF NOT EXISTS trigger_id UUID REFERENCES public.signal_triggers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_signals_trigger
  ON public.prospect_signals(workspace_id, trigger_id)
  WHERE trigger_id IS NOT NULL;

COMMENT ON COLUMN public.prospect_signals.trigger_id IS
  'Trigger qui a genere ce signal (NULL pour signaux pre-1.2.2).';

-- ---------------------------------------------------------------------------
-- 2. ADD COLUMN persona_id sur les 4 tables prospect (nullable, FK)
-- ---------------------------------------------------------------------------

ALTER TABLE public.prospect_profiles
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.icp_personas(id) ON DELETE SET NULL;

ALTER TABLE public.prospect_sequences
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.icp_personas(id) ON DELETE SET NULL;

ALTER TABLE public.prospect_messages
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.icp_personas(id) ON DELETE SET NULL;

ALTER TABLE public.prospect_message_templates
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.icp_personas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.prospect_profiles.persona_id IS 'Persona identifie pour ce contact. Remplace target_category (qui reste pour compat).';
COMMENT ON COLUMN public.prospect_sequences.persona_id IS 'Persona cible de cette sequence.';
COMMENT ON COLUMN public.prospect_messages.persona_id IS 'Persona du destinataire.';
COMMENT ON COLUMN public.prospect_message_templates.persona_id IS 'Persona cible du template.';

-- ---------------------------------------------------------------------------
-- 3. Backfill depuis target_category vers persona_id
-- ---------------------------------------------------------------------------

-- Mapping target_category -> persona slug
-- ('director' -> 'director', 'field_sales' -> 'field-sales', 'hr' -> 'hr-decision-maker')

DO $$
DECLARE
  ws_id UUID;
  personas_table_name TEXT;
BEGIN
  -- Pour chaque workspace, mapper target_category -> persona_id
  FOR ws_id IN SELECT id FROM public.workspaces LOOP
    -- prospect_profiles
    UPDATE public.prospect_profiles pp
    SET persona_id = ip.id
    FROM public.icp_personas ip
    WHERE pp.workspace_id = ws_id
      AND ip.workspace_id = ws_id
      AND pp.persona_id IS NULL
      AND (
        (pp.target_category = 'director'    AND ip.slug = 'director')
        OR (pp.target_category = 'field_sales' AND ip.slug = 'field-sales')
        OR (pp.target_category = 'hr'          AND ip.slug = 'hr-decision-maker')
      );

    -- prospect_sequences
    UPDATE public.prospect_sequences ps
    SET persona_id = ip.id
    FROM public.icp_personas ip
    WHERE ps.workspace_id = ws_id
      AND ip.workspace_id = ws_id
      AND ps.persona_id IS NULL
      AND (
        (ps.target_category = 'director'    AND ip.slug = 'director')
        OR (ps.target_category = 'field_sales' AND ip.slug = 'field-sales')
        OR (ps.target_category = 'hr'          AND ip.slug = 'hr-decision-maker')
      );

    -- prospect_messages
    UPDATE public.prospect_messages pm
    SET persona_id = ip.id
    FROM public.icp_personas ip
    WHERE pm.workspace_id = ws_id
      AND ip.workspace_id = ws_id
      AND pm.persona_id IS NULL
      AND (
        (pm.target_category = 'director'    AND ip.slug = 'director')
        OR (pm.target_category = 'field_sales' AND ip.slug = 'field-sales')
        OR (pm.target_category = 'hr'          AND ip.slug = 'hr-decision-maker')
      );

    -- prospect_message_templates
    UPDATE public.prospect_message_templates pmt
    SET persona_id = ip.id
    FROM public.icp_personas ip
    WHERE pmt.workspace_id = ws_id
      AND ip.workspace_id = ws_id
      AND pmt.persona_id IS NULL
      AND (
        (pmt.target_category = 'director'    AND ip.slug = 'director')
        OR (pmt.target_category = 'field_sales' AND ip.slug = 'field-sales')
        OR (pmt.target_category = 'hr'          AND ip.slug = 'hr-decision-maker')
      );
  END LOOP;
END $$;

-- (Pas de backfill de donnees ici : sur une instance neuve, prospect_signals
--  est vide et trigger_id est renseigne a l'insertion par scrape-job-signals.)

-- ---------------------------------------------------------------------------
-- 5. Indexes composites pour les queries chaudes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospect_profiles_workspace_persona
  ON public.prospect_profiles(workspace_id, persona_id)
  WHERE persona_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_messages_workspace_persona
  ON public.prospect_messages(workspace_id, persona_id)
  WHERE persona_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_sequences_workspace_persona
  ON public.prospect_sequences(workspace_id, persona_id)
  WHERE persona_id IS NOT NULL;

-- =============================================================================
-- NOTE : target_category n'est PAS dropee (backwards compat).
-- Drop prevu dans une migration future quand toutes les edge functions et
-- le frontend auront bascule sur persona_id.
-- =============================================================================

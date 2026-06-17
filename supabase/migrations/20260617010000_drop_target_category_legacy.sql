-- Retirer les colonnes legacy target_category du schema.
-- target_category était utilise uniquement pour compatibilite retroactive Jay.
-- Toutes les decisions utilisent desormais persona_id.

-- prospect_profiles : colonne principale
ALTER TABLE public.prospect_profiles
  DROP COLUMN IF EXISTS target_category CASCADE;

-- prospect_sequences (legacy table, peut ne pas exister)
ALTER TABLE public.prospect_sequences
  DROP COLUMN IF EXISTS target_category CASCADE;

-- prospect_message_templates (legacy table, peut ne pas exister)
ALTER TABLE public.prospect_message_templates
  DROP COLUMN IF EXISTS target_category CASCADE;

-- smartlead_campaigns (legacy table, peut ne pas exister)
ALTER TABLE public.smartlead_campaigns
  DROP COLUMN IF EXISTS target_category CASCADE;

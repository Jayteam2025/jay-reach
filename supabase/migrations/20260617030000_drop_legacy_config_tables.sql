-- Drop legacy configuration tables (prospect_templates, prospect_icp_filters, prospect_sequences)
-- These tables were used by the legacy ProspectionSequences component and useProspectConfig hooks
-- The current config uses icp_personas, signal_triggers, and prospect_message_templates instead

DROP TABLE IF EXISTS public.prospect_templates CASCADE;
DROP TABLE IF EXISTS public.prospect_icp_filters CASCADE;
DROP TABLE IF EXISTS public.prospect_sequences CASCADE;

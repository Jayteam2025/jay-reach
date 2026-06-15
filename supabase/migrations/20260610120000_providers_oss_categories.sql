-- Extend provider categories to include 'source' and 'llm'
ALTER TABLE public.workspace_providers DROP CONSTRAINT IF EXISTS workspace_providers_category_check;
ALTER TABLE public.workspace_providers ADD CONSTRAINT workspace_providers_category_check
  CHECK (category IN ('outreach', 'validator', 'enricher', 'source', 'llm'));

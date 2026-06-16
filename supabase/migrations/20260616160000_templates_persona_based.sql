-- =============================================================================
-- Templates de messages : modèle persona-based (drop du couplage legacy Jay)
-- =============================================================================
-- Le front templates était resté couplé aux 3 catégories Jay (hr/director/
-- field_sales) via prospect_message_templates.target_category (NOT NULL + CHECK)
-- alors que le backend est déjà persona_id. Conséquence : impossible de créer un
-- template pour un persona custom (target_category n'accepte que les 3 valeurs).
--
-- Ici : target_category devient optionnel (transition), et on ajoute un unique
-- (workspace_id, persona_id, channel) pour permettre l'upsert d'un template par
-- persona et par canal, pour N'IMPORTE quel persona du workspace.
-- =============================================================================

ALTER TABLE public.prospect_message_templates
  ALTER COLUMN target_category DROP NOT NULL;

ALTER TABLE public.prospect_message_templates
  DROP CONSTRAINT IF EXISTS prospect_message_templates_target_category_check;

-- Unique non-partiel : 1 template par (workspace, persona, canal). Les lignes
-- legacy à persona_id NULL restent distinctes (NULL distinct en unique PG).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmt_ws_persona_channel
  ON public.prospect_message_templates(workspace_id, persona_id, channel);

COMMENT ON COLUMN public.prospect_message_templates.target_category IS
  'DÉPRÉCIÉ (transition Jay legacy). Le driver est persona_id. NULL pour les personas custom.';

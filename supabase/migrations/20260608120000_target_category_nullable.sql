-- Dé-hardcoding PR3 : target_category devient un champ de transition.
-- Le driver d'affectation persona devient persona_id (NOT NULL, déjà en place).
-- target_category n'a de sens que pour les 3 personas Jay ; pour un workspace
-- tiers (slugs quelconques), il sera NULL. On retire donc NOT NULL + le CHECK
-- (enum Jay director/field_sales/hr) sur prospect_profiles UNIQUEMENT.
-- Les autres tables (message_templates, sequences, mailboxes, smartlead_campaigns)
-- restent inchangées (traitées en PR4). Drop physique de la colonne = différé.

ALTER TABLE public.prospect_profiles DROP CONSTRAINT IF EXISTS prospect_profiles_target_category_check;
ALTER TABLE public.prospect_profiles ALTER COLUMN target_category DROP NOT NULL;

COMMENT ON COLUMN public.prospect_profiles.target_category IS
  'DÉPRÉCIÉ (transition) : enum Jay legacy. Le driver est persona_id. Dérivé du slug du persona pour les personas Jay, NULL sinon. Sera droppé après PR4.';

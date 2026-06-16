-- Colonne `subject` manquante sur prospect_message_templates :
-- le front la sélectionne (sujet des templates d'email), mais elle n'avait pas
-- été reprise dans le baseline. Ajout idempotent.
alter table public.prospect_message_templates
  add column if not exists subject text;

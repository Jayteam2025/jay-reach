-- ============================================================================
-- Personas — champs enrichis (reprise du design legacy) : canaux prioritaires,
-- départements ciblés, prompt de scoring IA, actif/inactif. Les colonnes
-- name/description/title_patterns/title_exclusions/seniority/angle existent déjà.
-- RLS déjà active sur la table (cf. rls.sql) — aucune policy à ajouter.
-- ============================================================================

alter table personas add column if not exists channels_priority text[] not null default '{email}';
alter table personas add column if not exists department_patterns text[] not null default '{}';
alter table personas add column if not exists scoring_prompt text;
alter table personas add column if not exists is_active boolean not null default true;

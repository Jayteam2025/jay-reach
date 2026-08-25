-- ============================================================================
-- Droits d'accès pour les rôles de l'API Supabase. Les migrations créent les
-- tables + les POLICIES RLS, mais PostgREST accède aux tables via les rôles
-- `authenticated` / `service_role` : sans GRANT au niveau table, tout accès est
-- refusé (42501) AVANT même que la RLS ne filtre les lignes. Cette migration
-- accorde ces droits (la RLS fait le reste du travail de cloisonnement).
-- Repris de `test/pg-verify/grants.sql`, rendu permanent + privilèges par défaut.
-- ============================================================================

-- Rôle des utilisateurs connectés (RLS active, filtre par organisation).
grant usage on schema public, app to authenticated;
grant usage on schema auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all routines in schema public, app to authenticated;
grant execute on function auth.uid() to authenticated;

-- Rôle serveur/worker (bypass RLS ; utilisé côté service uniquement).
grant usage on schema public, app to service_role;
grant usage on schema auth to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all routines in schema public, app to service_role;

-- Privilèges par défaut : les futurs objets (prochaines migrations) sont couverts
-- automatiquement, sans avoir à re-granter à chaque table/fonction ajoutée.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant execute on routines to authenticated, service_role;
alter default privileges in schema app grant execute on routines to authenticated, service_role;

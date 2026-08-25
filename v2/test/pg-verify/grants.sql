-- Droits que Supabase accorde au rôle `authenticated` (la RLS fait le reste).
grant usage on schema public, app, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all routines in schema app to authenticated;
grant execute on function auth.uid() to authenticated;

-- service_role : le serveur/worker (bypass RLS). Reproduit ce que Supabase accorde.
grant usage on schema public, app, auth to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all routines in schema app, public to service_role;

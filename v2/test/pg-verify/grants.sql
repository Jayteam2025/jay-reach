-- Droits que Supabase accorde au rôle `authenticated` (la RLS fait le reste).
grant usage on schema public, app, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all routines in schema app to authenticated;
grant execute on function auth.uid() to authenticated;

-- Exception : `credentials_public` est une vue `definer` sans `with check
-- option`, donc un insert y échapperait au filtre par organisation. La
-- migration 20260909120000 lui reprend les droits d'écriture ; le grant global
-- ci-dessus, appliqué APRÈS les migrations, les rouvrirait dans la base de test.
revoke insert, update, delete on public.credentials_public from authenticated;

-- service_role : le serveur/worker (bypass RLS). Reproduit ce que Supabase accorde.
grant usage on schema public, app, auth to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all routines in schema app, public to service_role;

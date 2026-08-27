-- ============================================================================
-- Statut des fournisseurs visible par TOUS les membres de l'organisation.
--
-- La vue `credentials_public` (T5) tournait en `security_invoker = true` : elle
-- héritait donc de la policy `credentials_read` (admin-only) de la table, si
-- bien qu'un membre non-admin voyait « non configuré » partout, même quand les
-- clés étaient bien enregistrées. Or cette vue n'expose JAMAIS le secret (juste
-- provider_id / status / last4 / config).
--
-- On la passe en `security_invoker = false` (definer) et on filtre nous-mêmes
-- sur les organisations du membre connecté via `app.user_orgs()` : chaque membre
-- voit le statut de SES organisations, jamais celui des autres, et jamais le
-- secret. La table `credentials` garde sa policy admin-only (protection du
-- secret pour l'accès direct).
-- ============================================================================

-- `security_barrier = true` : la vue étant en definer (elle contourne la RLS de
-- `credentials`), le filtre `where organization_id in (app.user_orgs())` est la
-- seule protection. Sans barrière, le planificateur pourrait pousser un prédicat
-- appelant (opérateur « leaky ») sous ce filtre et exposer des lignes d'autres
-- organisations. La barrière l'interdit.
create or replace view public.credentials_public
  with (security_invoker = false, security_barrier = true) as
  select id, organization_id, provider_id, config, status, last4, last_checked_at, updated_at
  from public.credentials
  where organization_id in (select app.user_orgs());

grant select on public.credentials_public to authenticated;

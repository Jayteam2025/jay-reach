-- ============================================================================
-- `credentials_public` repasse en LECTURE SEULE pour les rôles de l'API.
--
-- La migration 20260826130000 n'accordait que `select` à `authenticated`, mais
-- Supabase applique des privilèges par défaut sur le schéma `public` : toute
-- table ou vue créée là reçoit automatiquement tous les droits pour `anon` et
-- `authenticated`. La vue héritait donc de `insert/update/delete/truncate`.
--
-- Or cette vue est en `security_invoker = false` (elle contourne la RLS de
-- `credentials`) et n'a pas de `with check option` : le filtre
-- `where organization_id in (app.user_orgs())` ne s'applique PAS à un insert.
-- Comme `secret` est nullable et que toutes les autres colonnes ont un défaut,
-- un appel `POST /rest/v1/credentials_public` suffisait à écrire une ligne de
-- credentials dans N'IMPORTE QUELLE organisation, sans être connecté pour
-- `anon`, et en contournant la policy admin-only de la table pour un simple
-- membre. Signalé par l'advisor Supabase (0010_security_definer_view).
--
-- On reprend les droits d'écriture. La vue reste ce qu'elle est censée être :
-- un statut consultable par les membres de l'organisation. Les écritures
-- passent par `set_provider_credential` (definer, chiffrement pgcrypto) ou par
-- `service_role` sur la table, pas par la vue.
-- ============================================================================

revoke all on public.credentials_public from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.credentials_public from authenticated;

grant select on public.credentials_public to authenticated;

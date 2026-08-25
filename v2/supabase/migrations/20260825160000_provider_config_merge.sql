-- ============================================================================
-- Mise à jour de la CONFIG (jsonb, non sensible) d'un provider sans toucher au
-- secret chiffré (T27, config webhook). `set_credential` ré-écrit le secret ;
-- or ici on veut seulement poser `config.webhook_secret` — qu'on ne peut pas
-- faire via `set_credential` sans re-fournir la clé API (indisponible en clair).
-- On merge donc la config (upsert), sans secret. `credentials.secret` étant
-- nullable, une ligne config-only est possible même avant que la clé API ne
-- soit renseignée.
--
-- Comme `set_provider_credential`, la fonction est réservée au `service_role`
-- (appelée par la server action APRÈS un `requireRole('admin')`) — le client
-- service n'a pas d'`auth.uid()`, donc pas de contrôle admin ici.
-- ============================================================================
create or replace function app.merge_provider_config(p_org uuid, p_provider text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public, app as $$
begin
  insert into credentials (organization_id, provider_id, config, status)
  values (p_org, p_provider, coalesce(p_config, '{}'), 'pending')
  on conflict (organization_id, provider_id) do update
    set config = coalesce(credentials.config, '{}') || coalesce(excluded.config, '{}'),
        updated_at = now();
end $$;

create or replace function public.merge_provider_config(p_org uuid, p_provider text, p_config jsonb)
returns void language sql security definer set search_path = public, app as $$
  select app.merge_provider_config(p_org, p_provider, p_config);
$$;
revoke all on function public.merge_provider_config(uuid, text, jsonb) from public;
grant execute on function public.merge_provider_config(uuid, text, jsonb) to service_role;

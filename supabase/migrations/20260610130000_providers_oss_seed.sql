-- Seed des providers prospection (anthropic/adzuna/france_travail)
-- Idempotent : avec WHERE NOT EXISTS pour éviter les doublons/conflits unicité

INSERT INTO public.workspace_providers (workspace_id, category, provider_type, channel, is_active, config)
SELECT w.id, v.category, v.provider_type, NULL, true,
       jsonb_build_object('fallback_env', v.fallback_env::jsonb)
FROM public.workspaces w
CROSS JOIN (VALUES
  ('llm'::text, 'anthropic'::text, '{"api_key":"ANTHROPIC_API_KEY"}'::jsonb),
  ('source'::text, 'adzuna'::text, '{"app_id":"ADZUNA_APP_ID","app_key":"ADZUNA_APP_KEY"}'::jsonb),
  ('source'::text, 'france_travail'::text, '{"client_id":"FRANCE_TRAVAIL_CLIENT_ID","client_secret":"FRANCE_TRAVAIL_CLIENT_SECRET"}'::jsonb)
) AS v(category, provider_type, fallback_env)
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_providers wp
  WHERE wp.workspace_id = w.id
    AND wp.category = v.category
    AND wp.provider_type = v.provider_type
);

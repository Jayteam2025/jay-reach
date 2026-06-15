-- Convert config.fallback_env string→map (back-compat)
-- If a provider had a historical fallback_env string, convert it to map {api_key: "<VALUE>"}.
UPDATE public.workspace_providers
SET config = jsonb_set(config, '{fallback_env}', jsonb_build_object('api_key', config->>'fallback_env'))
WHERE jsonb_typeof(config->'fallback_env') = 'string';

-- Provider Reoon (validateur email) — seedé INACTIF pour ne rien casser.
-- La bascule (Reoon actif → Bouncer inactif) se fait après la preuve sur staging,
-- par un UPDATE ciblé sur le workspace concerné (la contrainte UNIQUE garantit
-- qu'activer Reoon désactive l'autre validateur de la même catégorie).
-- Clé résolue via fallback env REOON_API_KEY (déjà présent en secret).
INSERT INTO public.workspace_providers (workspace_id, category, provider_type, channel, is_active, config)
SELECT w.id, 'validator', 'reoon', NULL, false,
       jsonb_build_object('fallback_env', jsonb_build_object('api_key', 'REOON_API_KEY'))
FROM public.workspaces w
ON CONFLICT DO NOTHING;

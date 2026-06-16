-- =============================================================================
-- Activation du dispatch des workers d'enrichissement (pg_net)
-- =============================================================================
-- spawn_enrichment_worker avait été laissé désactivé en croyant que enrich-company
-- gérait le dispatch sans RPC. FAUX : enqueue-enrichment ET enrich-company
-- appellent spawn_enrichment_worker (net.http_post -> enrich-company {job_id}) pour
-- démarrer / enchaîner les workers. Sans ce RPC, le job d'enrichissement reste
-- 'pending' indéfiniment (items jamais traités). pg_net est disponible sur l'OSS
-- (call_poll_prospect_batches l'utilise déjà). On crée donc les 2 RPC pg_net.
--
-- NB : pg_net n'était PAS activé sur ce projet OSS (le socle le supposait
-- pré-installé). On l'active ici, ce qui crée le schéma `net`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.spawn_enrichment_worker(
  p_functions_url text,
  p_service_role_key text,
  p_job_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'net'
AS $$
  SELECT net.http_post(
    url := p_functions_url || '/enrich-company',
    body := jsonb_build_object('job_id', p_job_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || p_service_role_key
    ),
    timeout_milliseconds := 2000
  );
$$;
REVOKE ALL ON FUNCTION public.spawn_enrichment_worker(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_enrichment_worker(text, text, uuid) TO service_role;

-- Sweep Bouncer de fin de job (validation email des profils enrichis récents).
CREATE OR REPLACE FUNCTION public.spawn_bouncer_sweep(
  p_functions_url text,
  p_service_role_key text
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'net'
AS $$
  SELECT net.http_post(
    url := p_functions_url || '/bouncer-batch?since_hours=24',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || p_service_role_key
    ),
    timeout_milliseconds := 2000
  );
$$;
REVOKE ALL ON FUNCTION public.spawn_bouncer_sweep(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_bouncer_sweep(text, text) TO service_role;

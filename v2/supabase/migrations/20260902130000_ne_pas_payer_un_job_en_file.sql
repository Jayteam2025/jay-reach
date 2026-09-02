-- Un job d'enrichissement déjà en file ne doit pas être repayé.
--
-- L'identifiant est déterministe par (compte, persona) : redéposer le même ne
-- crée rien. Mais le crédit était décompté avant l'insertion, donc pour un job
-- qui n'existera pas. Mesuré sur cette base le 02/09/2026 : cinq crédits
-- consommés dans la journée pour deux jobs réellement créés.
--
-- La table `pgboss.job` n'est pas lisible depuis le client : cette fonction
-- répond à la seule question utile, sans exposer la file.
create or replace function public.enrichissement_deja_en_file(
  p_account uuid, p_persona uuid
) returns boolean
language plpgsql
security definer
set search_path = 'public', 'pgboss'
as $$
declare
  v_hash text;
  v_id uuid;
begin
  select encode(digest('enrich-company ' || p_account::text || ' ' || p_persona::text, 'sha1'), 'hex')
    into v_hash;
  v_id := (substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4)
        || '-5' || substr(v_hash, 14, 3)
        || '-8' || substr(v_hash, 18, 3)
        || '-' || substr(v_hash, 21, 12))::uuid;

  return exists (
    select 1 from pgboss.job
     where id = v_id and state in ('created', 'retry', 'active')
  );
end $$;

revoke all on function public.enrichissement_deja_en_file(uuid, uuid) from public;
grant execute on function public.enrichissement_deja_en_file(uuid, uuid) to authenticated;

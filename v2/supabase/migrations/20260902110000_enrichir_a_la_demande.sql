-- Enrichir une entreprise choisie, depuis l'écran des signaux.
--
-- L'enrichissement est automatique : le producteur prend les comptes qualifiés
-- et les enfile dans la limite du plafond quotidien. C'est le bon régime une
-- fois la machine réglée, mais pas pour une mise en route, où l'on veut voir ce
-- que le fournisseur rend sur deux entreprises avant d'ouvrir les vannes. Le
-- socle v1 permettait de choisir dans la liste ce qu'on enrichissait ; cette
-- fonction rend ce geste.
--
-- Le job est déposé dans la même file que le producteur, avec la même forme de
-- données : un seul chemin d'exécution, donc pas de divergence possible entre
-- ce qui part à la main et ce qui part tout seul.
--
-- L'identifiant est déterministe par (compte, persona), comme celui du
-- producteur : cliquer deux fois ne dédouble pas la dépense.
create or replace function public.enfiler_enrichissement(
  p_org uuid,
  p_account uuid,
  p_company text,
  p_domain text,
  p_country text,
  p_persona uuid,
  p_titles text[],
  p_signal uuid
) returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
  v_hash text;
begin
  -- Même dérivation que `deterministicUuid('enrich-company', compte, persona)`
  -- côté worker, au caractère près : SHA-1 des composants joints par une
  -- espace, redécoupé au format d'un UUID v5. Une formule approchante — un md5,
  -- un séparateur différent — produirait un autre identifiant, et la demande
  -- manuelle dédoublerait le job automatique déjà en file. Donc la dépense.
  select encode(digest('enrich-company ' || p_account::text || ' ' || p_persona::text, 'sha1'), 'hex')
    into v_hash;
  v_id := (substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4)
        || '-5' || substr(v_hash, 14, 3)
        || '-8' || substr(v_hash, 18, 3)
        || '-' || substr(v_hash, 21, 12))::uuid;

  perform pgboss.send(
    'enrichment.company',
    jsonb_build_object(
      'organizationId', p_org,
      'accountId', p_account,
      'companyName', p_company,
      'personaId', p_persona,
      'positionTitles', to_jsonb(p_titles),
      'sourceSignalId', p_signal
    ) || case when p_domain is null then '{}'::jsonb else jsonb_build_object('domain', p_domain) end
       || case when p_country is null then '{}'::jsonb else jsonb_build_object('countryCode', p_country) end,
    jsonb_build_object('id', v_id)
  );

  return v_id;
end $$;

revoke all on function public.enfiler_enrichissement(uuid, uuid, text, text, text, uuid, text[], uuid) from public;
grant execute on function public.enfiler_enrichissement(uuid, uuid, text, text, text, uuid, text[], uuid) to authenticated;

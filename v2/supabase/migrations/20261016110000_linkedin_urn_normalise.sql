-- `contacts.linkedin_provider_id` porte désormais une seule forme : l'identifiant de membre NU
-- (`ACoAA…`), jamais l'URN complet `urn:li:fsd_profile:ACoAA…`. Une réponse LinkedIn ne porte que
-- l'URN de son expéditeur : la relève la compare à cette colonne, donc les deux formes ne peuvent
-- pas coexister. Voir `normaliserUrnLinkedIn` (packages/core/src/linkedin/identite.ts) : mêmes
-- préfixes, même forme d'identifiant.
--
-- Deuxième nettoyage : l'enrichissement FullEnrich écrivait dans cette colonne l'identifiant de SON
-- profil (un UUID, `p.id`), pas un identifiant de membre LinkedIn : 353 contacts sur 590 au 16/10.
-- Ces valeurs sont remises à NULL, ce qui rend visibles les contacts sans URN. Ciblé sur le motif
-- UUID strict, pas sur « tout ce qui n'est pas reconnu ». Rien n'est perdu tant que le contact garde
-- son adresse de profil, d'où une vérification AVANT d'effacer : une ligne à effacer sans
-- `linkedin_url` fait échouer la migration au lieu d'effacer en silence.
--
-- Seules les valeurs RECONNUES sont réécrites. Une valeur aberrante (adresse de profil, texte libre)
-- reste telle quelle : on ne détruit pas une donnée qu'on ne comprend pas, la lecture la traite en
-- « pas d'URN ». Aucun index unique ne porte sur la colonne : la normalisation ne peut pas créer de
-- collision bloquante.

-- [uuid]
do $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_attendu int;
  v_sans_url int;
  v_efface int;
begin
  select count(*), count(*) filter (where linkedin_url is null or btrim(linkedin_url) = '')
    into v_attendu, v_sans_url
    from public.contacts where linkedin_provider_id ~ v_uuid;
  if v_sans_url > 0 then
    raise exception '% contact(s) portent un UUID dans linkedin_provider_id sans linkedin_url : effacer perdrait tout lien avec leur profil', v_sans_url;
  end if;

  update public.contacts set linkedin_provider_id = null where linkedin_provider_id ~ v_uuid;
  get diagnostics v_efface = row_count;
  -- Ce qui est effacé est exactement ce qui a été compté, et rien d'autre : un écart annule tout.
  if v_efface <> v_attendu then
    raise exception 'effacement des UUID : % ligne(s) touchee(s) pour % comptee(s)', v_efface, v_attendu;
  end if;
  raise notice 'UUID FullEnrich remis a NULL dans linkedin_provider_id : %', v_efface;
end $$;

-- [urn]
update public.contacts
   set linkedin_provider_id = regexp_replace(linkedin_provider_id, '^urn:li:(fsd_profile|fs_miniProfile):', '')
 where linkedin_provider_id ~ '^urn:li:(fsd_profile|fs_miniProfile):[A-Za-z0-9_-]{5,}$'
   and linkedin_provider_id !~ '^urn:li:(fsd_profile|fs_miniProfile):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Contrôle : la migration échoue s'il reste un URN complet reconnaissable ou un UUID.
do $$
begin
  if exists (
    select 1 from public.contacts
     where linkedin_provider_id ~ '^urn:li:(fsd_profile|fs_miniProfile):[A-Za-z0-9_-]{5,}$'
       and linkedin_provider_id !~ '^urn:li:(fsd_profile|fs_miniProfile):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'des contacts portent encore un URN LinkedIn complet dans linkedin_provider_id';
  end if;
  if exists (
    select 1 from public.contacts
     where linkedin_provider_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'des contacts portent encore un UUID FullEnrich dans linkedin_provider_id';
  end if;
end $$;

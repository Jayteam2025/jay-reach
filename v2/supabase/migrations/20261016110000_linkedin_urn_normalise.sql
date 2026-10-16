-- `contacts.linkedin_provider_id` porte désormais une seule forme : l'identifiant de membre NU
-- (`ACoAA…`), jamais l'URN complet `urn:li:fsd_profile:ACoAA…`. Une réponse LinkedIn ne porte que
-- l'URN de son expéditeur : la relève la compare à cette colonne, donc les deux formes ne peuvent
-- pas coexister. Voir `normaliserUrnLinkedIn` (packages/core/src/linkedin/identite.ts) : mêmes
-- préfixes, même forme d'identifiant.
--
-- Seules les valeurs RECONNUES sont réécrites. Une valeur aberrante (adresse de profil, texte libre)
-- reste telle quelle : on ne détruit pas une donnée qu'on ne comprend pas, la lecture la traite en
-- « pas d'URN ». Aucun index unique ne porte sur la colonne : la normalisation ne peut pas créer de
-- collision bloquante.

update public.contacts
   set linkedin_provider_id = regexp_replace(linkedin_provider_id, '^urn:li:(fsd_profile|fs_miniProfile):', '')
 where linkedin_provider_id ~ '^urn:li:(fsd_profile|fs_miniProfile):(ACo|ACw|AEM)[A-Za-z0-9_-]{10,}$';

-- Contrôle : la migration échoue s'il reste un URN complet reconnaissable.
do $$
begin
  if exists (
    select 1 from public.contacts
     where linkedin_provider_id ~ '^urn:li:(fsd_profile|fs_miniProfile):(ACo|ACw|AEM)[A-Za-z0-9_-]{10,}$'
  ) then
    raise exception 'des contacts portent encore un URN LinkedIn complet dans linkedin_provider_id';
  end if;
end $$;

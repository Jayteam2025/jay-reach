-- Source d'engageurs d'un post : la configuration ne garde que urlPost, garder
-- et personaId. compteId, profilsParJour et exclurePremierDegre disparaissent
-- (l'exécution est côté serveur). Limité à linkedin_post_engagers : les trois
-- autres types linkedin_* exigent toujours compteId.
update sources
   set config = config - 'compteId' - 'profilsParJour' - 'exclurePremierDegre'
 where config->>'sourceType' = 'linkedin_post_engagers'
   and (config ? 'compteId' or config ? 'profilsParJour' or config ? 'exclurePremierDegre');

do $$
begin
  if exists (
    select 1 from sources
     where config->>'sourceType' = 'linkedin_post_engagers'
       and (config ? 'compteId' or config ? 'profilsParJour' or config ? 'exclurePremierDegre')
  ) then
    raise exception 'config_post_engagers : des sources d''engageurs portent encore un champ retire';
  end if;
end $$;

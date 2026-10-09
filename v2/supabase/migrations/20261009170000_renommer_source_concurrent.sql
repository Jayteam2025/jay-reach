-- Lot 4b, étape 2 : reprendre les sources « concurrent » des instances déjà installées.
--
-- Le type `linkedin_competitor_followers` est devenu `linkedin_competitor_posts`
-- (il annonçait des abonnés alors qu'il livre les engageurs des posts), et son
-- champ `comptesConcurrents` est devenu `pagesConcurrentes`.
--
-- La base de l'éditeur n'a aucune ligne de ce type, mais Jay Reach est
-- auto-hébergé : une autre instance peut en avoir. Sans cette reprise, une telle
-- ligne devient invisible du producteur (qui ne connaît plus ce type) tout en
-- étant tenue pour collectable par `collecteImplementee` — elle n'est plus un
-- type LinkedIn connu, donc elle passe pour un connecteur d'offres. La campagne
-- se lancerait sans que rien ne soit jamais collecté, et sans que l'écran le dise.
update sources
   set config = (config - 'comptesConcurrents')
              || jsonb_build_object('sourceType', 'linkedin_competitor_posts')
              || case
                   when config ? 'comptesConcurrents'
                     then jsonb_build_object('pagesConcurrentes', config -> 'comptesConcurrents')
                   else '{}'::jsonb
                 end
 where config->>'sourceType' = 'linkedin_competitor_followers';

-- Contrôle : la migration échoue s'il reste une ligne sous l'ancien nom, ou une
-- ligne du nouveau type qui porterait encore l'ancien champ.
do $$
declare
  v_anciennes int;
  v_champ int;
begin
  select count(*) into v_anciennes from sources where config->>'sourceType' = 'linkedin_competitor_followers';
  if v_anciennes > 0 then
    raise exception '% source(s) encore sous l''ancien type linkedin_competitor_followers', v_anciennes;
  end if;
  select count(*) into v_champ
    from sources
   where config->>'sourceType' = 'linkedin_competitor_posts' and config ? 'comptesConcurrents';
  if v_champ > 0 then
    raise exception '% source(s) concurrent portent encore comptesConcurrents', v_champ;
  end if;
end $$;

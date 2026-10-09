-- Lot 4b, étape 2 : l'interrupteur de la collecte LinkedIn automatique.
--
-- Jusqu'ici une source LinkedIn ne partait QUE sur demande (« Collecter
-- maintenant ») : le tour périodique les exclut délibérément, parce qu'il revient
-- toutes les quinze minutes pour un plafond de trois posts par jour. Résultat,
-- une veille de concurrent ne veillait pas : elle attendait un clic.
--
-- Le tour LinkedIn a donc sa propre cadence, un passage par source et par jour,
-- dans la fenêtre d'envoi de l'organisation. Et il ne part que si on le lui
-- demande : par défaut FAUX, parce que ce réglage fait sortir du trafic vers
-- LinkedIn tous les jours sans que personne ne clique, et que ce n'est pas au
-- dépôt d'en décider à la place de l'opérateur.
alter table linkedin_settings
  add column collect_auto boolean not null default false;

comment on column linkedin_settings.collect_auto is
  'Le serveur collecte-t-il les sources LinkedIn tout seul, un passage par source et par jour, dans la fenêtre d''envoi ? Faux par défaut.';

-- Contrôle : la migration échoue si la colonne n'est pas celle attendue.
do $$
declare
  v_default text;
  v_nullable text;
begin
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'linkedin_settings' and column_name = 'collect_auto';
  if v_default is null then
    raise exception 'linkedin_settings.collect_auto absente';
  end if;
  -- Un défaut à vrai ferait partir du trafic LinkedIn chez tout le monde a la
  -- première montée de version : c'est précisément ce qu'on refuse.
  if v_default not ilike 'false%' then
    raise exception 'linkedin_settings.collect_auto doit valoir faux par défaut, pas %', v_default;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'linkedin_settings.collect_auto doit être non nulle';
  end if;
end $$;

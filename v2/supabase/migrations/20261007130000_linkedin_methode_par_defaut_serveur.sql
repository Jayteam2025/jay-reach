-- Lot 4b : une ligne de `linkedin_action_queue` créée sans `method` est une ligne pour le serveur.
--
-- Jusqu'ici la colonne valait `extension_auto` par défaut. La réclamation ne prend que `serveur`
-- et les routes de l'extension rendent 410 : un INSERT qui omet la colonne (script de rattrapage,
-- futur appelant) créait une ligne que personne ne réclamerait jamais, et la déduplication
-- refusait ensuite tout nouvel enfilage du même (contact, type), sans le moindre message.
--
-- Additive : ne touche AUCUNE ligne existante (un défaut ne s'applique qu'aux insertions à venir),
-- et le check continue d'admettre `extension_auto` et `manual` pour les lignes historiques.

alter table linkedin_action_queue alter column method set default 'serveur';

-- Contrôle : la migration échoue si le défaut n'est pas celui attendu.
do $$
declare
  v_defaut text;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_defaut
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.linkedin_action_queue'::regclass and a.attname = 'method';
  if v_defaut is null or v_defaut not like '''serveur''%' then
    raise exception 'linkedin_action_queue.method : defaut attendu serveur, trouve %', coalesce(v_defaut, 'aucun');
  end if;
end $$;

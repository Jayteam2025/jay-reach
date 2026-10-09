-- ============================================================================
-- Lot 4b : la source « recherche par mot-clé » produit des signaux de PERSONNE
-- qui ne viennent d'aucun post. `post_engagement` aurait menti sur leur nature,
-- et son nom se lit à l'écran.
--
-- `alter type ... add value` ne peut pas être suivi d'un usage de la valeur dans
-- la MÊME transaction (Postgres). Cette migration ne fait donc QUE l'ajout :
-- tout ce qui s'en sert vit dans le code, pas ici.
--
-- Additive et idempotente : `if not exists` la rend rejouable, et aucune ligne
-- existante ne change de valeur.
-- ============================================================================

alter type signal_kind add value if not exists 'people_search';

-- Se vérifie elle-même : sans ce bloc, un échec silencieux laisserait le code
-- insérer une valeur que l'enum refuse, et l'erreur n'apparaîtrait qu'au premier
-- passage réel de collecte, chez l'opérateur.
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'signal_kind' and e.enumlabel = 'people_search'
  ) then
    raise exception 'signal_kind ne porte pas la valeur people_search';
  end if;
end $$;

-- Lot 4a, tâche 6 : un engageur d'un post LinkedIn devient un signal de kind
-- `post_engagement` (une PERSONNE, là où les autres kinds disent une entreprise).
--
-- Cette migration ne fait QUE poser la valeur. `signal_kind` est un enum
-- Postgres, et une valeur ajoutée n'est pas utilisable dans la transaction qui
-- l'ajoute : l'index unique restreint à ce kind vit donc dans la migration
-- suivante (20261005130305), exécutée dans sa propre transaction. Le bloc de
-- contrôle lit `pg_enum` pour la même raison : une insertion d'essai échouerait.
alter type signal_kind add value if not exists 'post_engagement';

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'signal_kind' and e.enumlabel = 'post_engagement'
  ) then
    raise exception 'signal_kind ne porte pas la valeur post_engagement';
  end if;
end $$;

-- Lot 4b, étape 2 : combien de POSTS un passage a réellement ouverts.
--
-- `compterPostsLinkedInDuJour` comptait un par PASSAGE. C'était juste tant qu'un
-- passage ouvrait exactement un post. Depuis que le collecteur boucle sur
-- plusieurs posts dans un seul passage, le plafond du jour ne borne plus rien :
-- avec un plafond de 3, le premier passage ouvre 3 posts et compte pour 1, le
-- deuxième en ouvre 2, le troisième 1 — six posts ouverts pour un plafond de
-- trois. La série vaut N(N+1)/2 : un plafond réglé à 10 laisserait passer 55
-- posts dans la journée.
--
-- La colonne porte donc le nombre réel, et le compteur en fait la somme.
alter table source_runs
  add column posts int;

comment on column source_runs.posts is
  'Nombre de posts LinkedIn réellement ouverts par ce passage. Null pour les passages antérieurs au lot 4b étape 2, qui en ouvraient exactement un.';

-- Contrôle : la migration échoue si la colonne n'est pas celle attendue.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'source_runs' and column_name = 'posts'
       and data_type = 'integer'
  ) then
    raise exception 'source_runs.posts absente ou du mauvais type';
  end if;
  -- Nullable DÉLIBÉRÉMENT : un défaut à 0 ferait compter zéro post aux passages
  -- déjà en base, qui en ont bien ouvert un. Le lecteur les ramène à 1 par
  -- `coalesce`, ce qu'un défaut rendrait impossible à distinguer.
  if (select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'source_runs' and column_name = 'posts') <> 'YES' then
    raise exception 'source_runs.posts doit rester nullable : null distingue les passages antérieurs';
  end if;
end $$;

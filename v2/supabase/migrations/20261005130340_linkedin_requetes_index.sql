-- Lot 4a, tâche 7 (round 3) : l'index qui manquait sur la trace des requêtes.
--
-- Trois chemins lisent `linkedin_requetes` par passage : le plafond de posts du
-- jour et le disjoncteur posent chacun un `exists (… where source_run_id = …)`,
-- et la clé étrangère `on delete cascade` scanne la table à chaque suppression de
-- passage. Sans index, chacun fait un parcours complet. La table grossit sans
-- borne — au plafond par défaut, soixante requêtes par heure, soit mille quatre
-- cents lignes par jour — donc le coût croît avec l'âge de l'instance.
create index if not exists linkedin_requetes_run_idx on linkedin_requetes (source_run_id);

-- Contrôle : la migration échoue si l'index attendu est absent.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'linkedin_requetes' and indexname = 'linkedin_requetes_run_idx'
  ) then
    raise exception 'index manquant : linkedin_requetes_run_idx';
  end if;
end $$;

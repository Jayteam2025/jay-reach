-- Lot 4a, revue finale : le bilan d'un passage de collecte, lu par l'écran Sources.
-- Les colonnes de la migration 20261005130310 (vus, nouveaux, doublons,
-- deja_en_campagne, ecartes, requetes) sont lues par la carte de la source
-- LinkedIn, avec `error`. Quatre colonnes de plus pour ce que le bilan fondait
-- ou ne gardait pas :
--  - `ignores` : profils que la réponse Voyager n'a pas renseignés assez pour
--    être exploitables (la part d'intitulés exploitables, mesure 1 de la spec) ;
--  - `opposes` : personnes écartées parce qu'elles figurent sur la liste de
--    suppression, un fait qu'on peut avoir à démontrer ;
--  - `adresses_deduites` : personnes enregistrées sous une adresse déduite de
--    l'URN, que ni LinkedIn ni FullEnrich ne résolvent : le scoring et
--    l'enrichissement les laissent de côté, ce chiffre dit combien ;
--  - `plafond_personnes_atteint` : le passage s'est arrêté sur le plafond de
--    personnes enregistrées par passage (`linkedin_personnes_par_passage`).
alter table source_runs add column if not exists ignores int not null default 0;
alter table source_runs add column if not exists opposes int not null default 0;
alter table source_runs add column if not exists adresses_deduites int not null default 0;
alter table source_runs add column if not exists plafond_personnes_atteint boolean not null default false;

-- Contrôle : la migration échoue si une colonne attendue est absente.
do $$
declare
  v_col text;
begin
  foreach v_col in array array['ignores','opposes','adresses_deduites','plafond_personnes_atteint'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'source_runs' and column_name = v_col
    ) then
      raise exception 'colonne manquante : source_runs.%', v_col;
    end if;
  end loop;
end $$;

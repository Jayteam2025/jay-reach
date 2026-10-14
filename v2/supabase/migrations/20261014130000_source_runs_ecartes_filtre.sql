-- Issue #164 : le filtre d'intitulé des sources LinkedIn écarte à la collecte, avant le scoring.
-- `ecartes_filtre` compte ces personnes par passage. `ecartes` (migration 20261005130310) reste
-- celui du scoring : les deux disent des choses différentes, et les additionner masquerait ce que
-- le filtre épargne en appels payants.
alter table source_runs add column if not exists ecartes_filtre integer not null default 0;

-- Contrôle : la migration échoue si la colonne attendue est absente.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'source_runs' and column_name = 'ecartes_filtre'
  ) then
    raise exception 'colonne manquante : source_runs.ecartes_filtre';
  end if;
end $$;

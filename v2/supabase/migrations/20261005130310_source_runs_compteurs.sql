-- Lot 4a, tâche 6 : le journal d'un passage de collecte LinkedIn. Les colonnes
-- existent AVANT le collecteur (tâche 7) parce que l'étape de scoring incrémente
-- déjà `ecartes`. `requetes` compte les requêtes émises vers LinkedIn, l'unité
-- des plafonds ; `ip_sortie` et `operateur_sortie` disent d'où le passage est
-- parti. Jamais d'URL de proxy ici : seulement l'IP observée.
alter table source_runs add column if not exists requetes int not null default 0;
alter table source_runs add column if not exists vus int not null default 0;
alter table source_runs add column if not exists nouveaux int not null default 0;
alter table source_runs add column if not exists doublons int not null default 0;
alter table source_runs add column if not exists deja_en_campagne int not null default 0;
alter table source_runs add column if not exists ecartes int not null default 0;
alter table source_runs add column if not exists ip_sortie text;
alter table source_runs add column if not exists operateur_sortie text;

-- Le passage qui a collecté un signal de personne : c'est lui que l'écart par le
-- scoring incrémente (le scoring, plafonné, juge souvent des passages plus tard).
alter table signals add column if not exists source_run_id uuid references source_runs(id) on delete set null;
create index if not exists signals_source_run_idx on signals (source_run_id) where source_run_id is not null;

-- Contrôle : la migration échoue si une colonne attendue est absente.
do $$
declare
  v_col text;
begin
  foreach v_col in array array['requetes','vus','nouveaux','doublons','deja_en_campagne','ecartes','ip_sortie','operateur_sortie'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'source_runs' and column_name = v_col
    ) then
      raise exception 'colonne manquante : source_runs.%', v_col;
    end if;
  end loop;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'signals' and column_name = 'source_run_id'
  ) then
    raise exception 'colonne manquante : signals.source_run_id';
  end if;
end $$;

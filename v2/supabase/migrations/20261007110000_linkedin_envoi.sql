-- Lot 4b : la base accepte un envoi LinkedIn exécuté par le serveur.
--
-- Additive : aucune ligne existante n'est touchée. Les deux lignes `sent` en
-- `extension_auto` et les lignes de collecte de `linkedin_requetes` (qui portent
-- un `source_run_id`) restent valides.
--
--   1. `linkedin_action_queue.method` admet 'serveur'.
--   2. `linkedin_requetes` trace aussi un envoi : `source_run_id` devient
--      nullable, `action_queue_id` désigne l'action, et exactement l'une des deux
--      origines doit être renseignée.
--   3. `linkedin_server_sessions.envoi_pause_jusqua` porte la pause automatique
--      (plafond atteint, 429) : l'action repart quand la date est passée. Nulle =
--      aucune pause.

-- 1. Méthode d'exécution. Le nom du check est celui que Postgres a généré ; on le
-- retrouve par sa définition plutôt que de le supposer.
do $$
declare
  v_nom text;
begin
  for v_nom in
    select conname from pg_constraint
     where conrelid = 'public.linkedin_action_queue'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%extension_auto%'
  loop
    execute format('alter table public.linkedin_action_queue drop constraint %I', v_nom);
  end loop;
end $$;

alter table linkedin_action_queue
  add constraint linkedin_action_queue_method_check
  check (method in ('extension_auto', 'manual', 'serveur'));

-- 2. Trace par requête : collecte (source_run_id) ou envoi (action_queue_id).
alter table linkedin_requetes alter column source_run_id drop not null;

alter table linkedin_requetes
  add column action_queue_id uuid references linkedin_action_queue(id) on delete set null;

-- Piège : `on delete set null` viderait l'origine d'une ligne d'envoi si
-- l'action était supprimée, et la contrainte ferait échouer cette suppression.
-- La file ne supprime jamais ses actions (elle les passe en `cancelled`) ; seule
-- la suppression en cascade d'une organisation les emporte, et elle emporte aussi
-- `linkedin_requetes` (même parent), donc rien n'échoue.
alter table linkedin_requetes
  add constraint linkedin_requetes_une_origine
  check ((source_run_id is null) <> (action_queue_id is null));

create index linkedin_requetes_action_idx on linkedin_requetes (action_queue_id)
  where action_queue_id is not null;

-- 3. Pause automatique de l'envoi.
alter table linkedin_server_sessions add column envoi_pause_jusqua timestamptz;

-- Contrôle : la migration échoue si l'un des objets attendus manque.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.linkedin_action_queue'::regclass
       and conname = 'linkedin_action_queue_method_check'
       and pg_get_constraintdef(oid) like '%serveur%'
  ) then
    raise exception 'check method sans serveur';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_requetes'::regclass and attname = 'source_run_id' and attnotnull
  ) then
    raise exception 'source_run_id encore NOT NULL';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_requetes'::regclass and attname = 'action_queue_id' and not attisdropped
  ) then
    raise exception 'action_queue_id absente';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.linkedin_requetes'::regclass and conname = 'linkedin_requetes_une_origine'
  ) then
    raise exception 'contrainte une_origine absente';
  end if;
  if to_regclass('public.linkedin_requetes_action_idx') is null then
    raise exception 'index action_queue_id absent';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_server_sessions'::regclass and attname = 'envoi_pause_jusqua' and not attisdropped
  ) then
    raise exception 'envoi_pause_jusqua absente';
  end if;
end $$;

-- Lot 4a, tâche 11 (tour 2) : le passage de la purge de rétention est visible à l'écran Moteur.
-- La phrase affichée aux personnes promet un effacement : si la purge s'arrête, il faut le voir.
-- Colonnes séparées de `last_error` : un tour de production réussi remet celle-ci à zéro, il
-- effacerait en quelques minutes l'échec de la purge.

alter table public.engine_status add column if not exists last_purge_at timestamptz;
alter table public.engine_status add column if not exists last_purge_error text;

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'engine_status'
         and column_name in ('last_purge_at', 'last_purge_error')) <> 2 then
    raise exception 'engine_status : colonnes de la purge absentes';
  end if;
end $$;

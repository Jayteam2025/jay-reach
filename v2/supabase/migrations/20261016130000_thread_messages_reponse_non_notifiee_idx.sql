-- Le balayage des réponses LinkedIn relevées mais pas encore notifiées (`balayerReponsesNonNotifiees`) lit
-- `thread_messages` sur `raw ->> 'notifiee' = 'false'` à chaque passage de relève et par organisation, sur une
-- table qui ne fait que grossir. Index PARTIEL : il ne contient que les messages en attente de notification
-- (quelques lignes à la fois, jamais l'historique). Le prédicat est celui, mot pour mot, de la requête : le
-- planificateur ne le prend que s'il le reconnaît. Additif, sans verrou long.

create index if not exists thread_messages_reponse_non_notifiee_idx
  on public.thread_messages (thread_id)
  where (raw ->> 'notifiee') = 'false';

-- Contrôle : l'index existe, porte le prédicat `notifiee = false`, n'est pas unique.
do $$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'thread_messages_reponse_non_notifiee_idx';
  if v_def is null then
    raise exception 'index thread_messages_reponse_non_notifiee_idx absent';
  end if;
  if v_def not like '%notifiee%' or v_def not like '%WHERE%''false''%' then
    raise exception 'index thread_messages_reponse_non_notifiee_idx de forme inattendue : %', v_def;
  end if;
  if v_def like '%UNIQUE%' then
    raise exception 'index thread_messages_reponse_non_notifiee_idx ne doit pas etre unique : %', v_def;
  end if;
end $$;

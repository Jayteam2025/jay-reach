-- Le balayage des réponses LinkedIn de l'opérateur (`balayerReponsesSansSort`, `existeReponseSansSort`)
-- joint `thread_messages.raw ->> 'queue_id'` à `linkedin_action_queue.id` et filtre sur
-- `raw ->> 'etat' = 'en_cours'`. Il tourne à chaque tick et par organisation, sur une table qui ne
-- fait que grossir, et la seule clé existante est `thread_messages_thread_idx` : sans index, chaque
-- tick lirait toute la table.
--
-- Index PARTIEL : il ne contient que les messages `en_cours`, c'est-à-dire ceux d'une réponse en
-- route (quelques lignes à la fois, jamais l'historique). Le prédicat est celui, mot pour mot, des
-- trois requêtes : le planificateur ne le prend que s'il le reconnaît. Additif, sans verrou long.

create index if not exists thread_messages_reponse_en_cours_idx
  on public.thread_messages ((raw ->> 'queue_id'))
  where (raw ->> 'etat') = 'en_cours';

-- Contrôle : l'index existe, porte l'expression `queue_id` et le prédicat `en_cours`.
do $$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'thread_messages_reponse_en_cours_idx';
  if v_def is null then
    raise exception 'index thread_messages_reponse_en_cours_idx absent';
  end if;
  -- Le nom de l'index contient déjà `en_cours` : on cherche le littéral entre apostrophes, après WHERE.
  if v_def not like '%queue_id%' or v_def not like '%WHERE%''en_cours''%' then
    raise exception 'index thread_messages_reponse_en_cours_idx de forme inattendue : %', v_def;
  end if;
  if v_def like '%UNIQUE%' then
    raise exception 'index thread_messages_reponse_en_cours_idx ne doit pas etre unique : %', v_def;
  end if;
end $$;

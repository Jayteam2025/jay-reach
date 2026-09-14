-- threads a déjà organization_id (voir 20260817120000_init_schema.sql) : l'index
-- de traitement porte donc directement dessus, pas besoin de joindre contacts.
alter table threads add column if not exists handled_at timestamptz;
alter table threads add column if not exists interest text check (interest in ('interested','not_interested'));
alter table threads add column if not exists last_message_at timestamptz;
update threads t set last_message_at = (select max(sent_at) from thread_messages m where m.thread_id = t.id) where last_message_at is null;
create index if not exists threads_a_traiter_idx on threads (organization_id, handled_at) where handled_at is null;

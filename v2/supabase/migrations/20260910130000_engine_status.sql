-- Battement de coeur du moteur : une ligne par instance de worker, mise a jour a chaque tour.
-- Lue par l'ecran pour dire si le moteur tourne ; ecrite par le worker (role de service).
create table if not exists public.engine_status (
  instance_id text primary key,
  hostname text not null,
  version text not null default 'inconnu',
  started_at timestamptz not null,
  last_tick_at timestamptz,
  last_produce_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

comment on table public.engine_status is 'Battement de coeur du moteur v2 (worker). Une ligne par instance.';

alter table public.engine_status enable row level security;
alter table public.engine_status force row level security;

drop policy if exists engine_status_read on public.engine_status;
create policy engine_status_read on public.engine_status
  for select to authenticated using (true);

revoke all on public.engine_status from public;
grant select on public.engine_status to authenticated;
grant select, insert, update, delete on public.engine_status to service_role;

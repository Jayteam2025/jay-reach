-- Ajout en masse depuis l'annuaire (retours 1.1 et 1.3).
--
-- Ajouter dix mille entreprises une par une n'est pas un usage : c'est ce que
-- l'écran imposait. « Ajouter tous les résultats » doit prendre l'intégralité du
-- jeu de résultats, y compris ce qui n'a pas encore été paginé, donc jusqu'à
-- quatre cents appels à l'API publique. Ça ne tient pas dans une requête HTTP.
--
-- Même mécanique que la collecte à la demande : l'application dépose la
-- demande, le worker la relève. Lui ajouter pg-boss pour un bouton reviendrait
-- à en dupliquer la moitié.
create table if not exists directory_bulk_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Les critères de la recherche, tels que l'écran les a soumis. On rejoue la
  -- recherche côté worker plutôt que de transporter dix mille SIREN.
  params jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error', 'cancelled')),
  -- Ce que l'API annonce ; plafonné à 10 000 par elle.
  total int not null default 0,
  processed int not null default 0,
  added int not null default 0,
  existing int not null default 0,
  -- Posé par l'écran quand l'opérateur annule. Le worker le relit entre deux
  -- pages : une annulation ne doit pas attendre la fin des quatre cents appels.
  cancel_requested_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists directory_bulk_imports_a_traiter
  on directory_bulk_imports (created_at) where status in ('pending', 'running');
create index if not exists directory_bulk_imports_org
  on directory_bulk_imports (organization_id, created_at desc);

alter table directory_bulk_imports enable row level security;
alter table directory_bulk_imports force row level security;

drop policy if exists directory_bulk_imports_read on public.directory_bulk_imports;
create policy directory_bulk_imports_read on public.directory_bulk_imports for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

drop policy if exists directory_bulk_imports_write on public.directory_bulk_imports;
create policy directory_bulk_imports_write on public.directory_bulk_imports for all to authenticated
  using (organization_id in (select app.user_orgs('operator')))
  with check (organization_id in (select app.user_orgs('operator')));

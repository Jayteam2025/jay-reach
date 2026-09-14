create table if not exists contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists contact_notes_contact_idx on contact_notes (contact_id, created_at desc);
alter table contact_notes enable row level security;
create policy contact_notes_membres on contact_notes for all
  using (contact_id in (select c.id from contacts c join memberships m on m.organization_id = c.organization_id where m.user_id = auth.uid()))
  with check (contact_id in (select c.id from contacts c join memberships m on m.organization_id = c.organization_id where m.user_id = auth.uid()));

create table if not exists organization_settings (
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (organization_id, key)
);
alter table organization_settings enable row level security;
create policy organization_settings_lecture on organization_settings for select
  using (organization_id in (select organization_id from memberships where user_id = auth.uid()));
create policy organization_settings_ecriture on organization_settings for all
  using (organization_id in (select organization_id from memberships where user_id = auth.uid() and role in ('admin','owner')))
  with check (organization_id in (select organization_id from memberships where user_id = auth.uid() and role in ('admin','owner')));
comment on table organization_settings is 'Plafonds et réglages de l''organisation (spec lot 2 §7) : une ligne par clé, valeur jsonb.';

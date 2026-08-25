-- ============================================================================
-- T2 — Row Level Security. Une organisation ne voit jamais les données d'une
-- autre. Le worker utilise la clé de service (bypass RLS) et filtre lui-même.
-- ============================================================================

create schema if not exists app;

-- Rang numérique d'un rôle (hiérarchie viewer < operator < admin < owner).
create or replace function app.role_rank(r membership_role)
returns int language sql immutable as $$
  select case r
    when 'owner' then 4
    when 'admin' then 3
    when 'operator' then 2
    when 'viewer' then 1
  end;
$$;

-- Organisations où l'utilisateur courant a AU MOINS le rôle demandé.
create or replace function app.user_orgs(min_role membership_role default 'viewer')
returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = auth.uid()
    and app.role_rank(m.role) >= app.role_rank(min_role);
$$;

-- Bootstrap : créer une organisation et s'y attacher en owner (une seule requête).
create or replace function app.create_organization(p_name text, p_slug text, p_locale text default 'fr')
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'authentification requise';
  end if;
  insert into public.organizations (name, slug, default_locale)
    values (p_name, p_slug, p_locale)
    returning id into v_org;
  insert into public.memberships (organization_id, user_id, role)
    values (v_org, auth.uid(), 'owner');
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Activation RLS sur toutes les tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'organizations','memberships','credentials','sources','source_runs','signals',
      'accounts','personas','contacts','lists','list_members','imports','customer_lists',
      'campaigns','message_templates','sequence_steps','senders','contact_sender_bindings',
      'enrollments','actions','outcomes','suppressions','threads','thread_messages',
      'notification_preferences','push_subscriptions','notifications','audit_events'
    ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helper de génération des policies org-scoped :
--   read  = membre (viewer+)   write = rôle minimum donné
-- ---------------------------------------------------------------------------
create or replace function app._gen_org_policies(p_table text, p_write_role membership_role)
returns void language plpgsql as $$
begin
  execute format($f$
    create policy %1$I_read on public.%1$I for select to authenticated
      using (organization_id in (select app.user_orgs('viewer')));
  $f$, p_table);
  execute format($f$
    create policy %1$I_write on public.%1$I for all to authenticated
      using (organization_id in (select app.user_orgs(%2$L)))
      with check (organization_id in (select app.user_orgs(%2$L)));
  $f$, p_table, p_write_role);
end;
$$;

-- Tables opérationnelles : écriture operator+
select app._gen_org_policies(t, 'operator') from unnest(array[
  'signals','accounts','contacts','lists','imports','enrollments','actions',
  'suppressions','threads','senders'
]) as t;

-- Tables de configuration : écriture admin+
select app._gen_org_policies(t, 'admin') from unnest(array[
  'credentials','sources','personas','campaigns','message_templates','customer_lists'
]) as t;

-- ---------------------------------------------------------------------------
-- Cas particuliers
-- ---------------------------------------------------------------------------

-- organizations : lecture membre ; écriture owner/admin ; création via fonction.
create policy organizations_read on public.organizations for select to authenticated
  using (id in (select app.user_orgs('viewer')));
create policy organizations_write on public.organizations for update to authenticated
  using (id in (select app.user_orgs('admin')))
  with check (id in (select app.user_orgs('admin')));
create policy organizations_delete on public.organizations for delete to authenticated
  using (id in (select app.user_orgs('owner')));

-- memberships : lecture des membres de ses orgs ; gestion admin+.
create policy memberships_read on public.memberships for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));
create policy memberships_write on public.memberships for all to authenticated
  using (organization_id in (select app.user_orgs('admin')))
  with check (organization_id in (select app.user_orgs('admin')));

-- Tables enfant sans organization_id : on remonte au parent.
create policy sequence_steps_read on public.sequence_steps for select to authenticated
  using (exists (select 1 from public.campaigns c
    where c.id = sequence_steps.campaign_id and c.organization_id in (select app.user_orgs('viewer'))));
create policy sequence_steps_write on public.sequence_steps for all to authenticated
  using (exists (select 1 from public.campaigns c
    where c.id = sequence_steps.campaign_id and c.organization_id in (select app.user_orgs('admin'))))
  with check (exists (select 1 from public.campaigns c
    where c.id = sequence_steps.campaign_id and c.organization_id in (select app.user_orgs('admin'))));

create policy source_runs_read on public.source_runs for select to authenticated
  using (exists (select 1 from public.sources s
    where s.id = source_runs.source_id and s.organization_id in (select app.user_orgs('viewer'))));
create policy source_runs_write on public.source_runs for all to authenticated
  using (exists (select 1 from public.sources s
    where s.id = source_runs.source_id and s.organization_id in (select app.user_orgs('operator'))))
  with check (exists (select 1 from public.sources s
    where s.id = source_runs.source_id and s.organization_id in (select app.user_orgs('operator'))));

create policy list_members_read on public.list_members for select to authenticated
  using (exists (select 1 from public.lists l
    where l.id = list_members.list_id and l.organization_id in (select app.user_orgs('viewer'))));
create policy list_members_write on public.list_members for all to authenticated
  using (exists (select 1 from public.lists l
    where l.id = list_members.list_id and l.organization_id in (select app.user_orgs('operator'))))
  with check (exists (select 1 from public.lists l
    where l.id = list_members.list_id and l.organization_id in (select app.user_orgs('operator'))));

create policy outcomes_read on public.outcomes for select to authenticated
  using (exists (select 1 from public.actions a
    where a.id = outcomes.action_id and a.organization_id in (select app.user_orgs('viewer'))));
create policy outcomes_write on public.outcomes for all to authenticated
  using (exists (select 1 from public.actions a
    where a.id = outcomes.action_id and a.organization_id in (select app.user_orgs('operator'))))
  with check (exists (select 1 from public.actions a
    where a.id = outcomes.action_id and a.organization_id in (select app.user_orgs('operator'))));

create policy thread_messages_read on public.thread_messages for select to authenticated
  using (exists (select 1 from public.threads th
    where th.id = thread_messages.thread_id and th.organization_id in (select app.user_orgs('viewer'))));
create policy thread_messages_write on public.thread_messages for all to authenticated
  using (exists (select 1 from public.threads th
    where th.id = thread_messages.thread_id and th.organization_id in (select app.user_orgs('operator'))))
  with check (exists (select 1 from public.threads th
    where th.id = thread_messages.thread_id and th.organization_id in (select app.user_orgs('operator'))));

create policy contact_sender_bindings_read on public.contact_sender_bindings for select to authenticated
  using (exists (select 1 from public.contacts c
    where c.id = contact_sender_bindings.contact_id and c.organization_id in (select app.user_orgs('viewer'))));
create policy contact_sender_bindings_write on public.contact_sender_bindings for all to authenticated
  using (exists (select 1 from public.contacts c
    where c.id = contact_sender_bindings.contact_id and c.organization_id in (select app.user_orgs('operator'))))
  with check (exists (select 1 from public.contacts c
    where c.id = contact_sender_bindings.contact_id and c.organization_id in (select app.user_orgs('operator'))));

-- Tables par utilisateur.
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_events : lecture membre, insertion append-only, jamais d'update/delete.
create policy audit_events_read on public.audit_events for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));
create policy audit_events_insert on public.audit_events for insert to authenticated
  with check (organization_id in (select app.user_orgs('viewer')));

create or replace function app.audit_events_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events est append-only : ni UPDATE ni DELETE';
end;
$$;
create trigger audit_events_no_update before update on public.audit_events
  for each row execute function app.audit_events_immutable();
create trigger audit_events_no_delete before delete on public.audit_events
  for each row execute function app.audit_events_immutable();

-- Session LinkedIn du serveur : une ligne par organisation.
--
-- Le navigateur piloté sur le VPS ouvre une session LinkedIn. Cette table dit
-- où elle en est (absente, active, bloquée et pourquoi), depuis quelle IP elle
-- sort, et porte le verrou qui empêche deux processus de la conduire en même
-- temps : deux navigateurs sur le même compte, c'est le signal qui fait sauter
-- la session.
--
-- Aucune clé, aucun cookie, aucune URL de proxy ici : seulement l'état et l'IP
-- observée.

create table linkedin_server_sessions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  status text not null default 'absente' check (status in ('absente', 'active', 'bloquee')),
  connected_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text check (blocked_reason in ('defi', 'cookie_refuse', 'sortie_inattendue', 'disjoncteur', 'revoquee')),
  -- IP de sortie attendue (posée à l'activation) et dernière IP réellement vue.
  expected_egress_ip text,
  last_egress_ip text,
  last_egress_org text,
  last_egress_country text,
  last_collect_at timestamptz,
  -- Verrou d'exclusion : un seul propriétaire tant que lock_until est dans le futur.
  lock_owner text,
  lock_until timestamptz,
  -- Un motif n'a de sens que sur une session bloquée.
  constraint linkedin_server_sessions_motif_coherent
    check ((status = 'bloquee') = (blocked_reason is not null))
);

alter table linkedin_server_sessions enable row level security;
alter table linkedin_server_sessions force row level security;

select app._gen_org_policies('linkedin_server_sessions', 'admin');

-- Contrôle : la migration échoue si l'objet attendu est absent.
do $$
declare
  v_col text;
begin
  if to_regclass('public.linkedin_server_sessions') is null then
    raise exception 'linkedin_server_sessions absente';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.linkedin_server_sessions'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RLS non activée sur linkedin_server_sessions';
  end if;
  foreach v_col in array array[
    'organization_id', 'status', 'connected_at', 'blocked_at', 'blocked_reason',
    'expected_egress_ip', 'last_egress_ip', 'last_egress_org', 'last_egress_country',
    'last_collect_at', 'lock_owner', 'lock_until'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'linkedin_server_sessions' and column_name = v_col
    ) then
      raise exception 'colonne manquante : linkedin_server_sessions.%', v_col;
    end if;
  end loop;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'linkedin_server_sessions') < 2 then
    raise exception 'politiques RLS manquantes sur linkedin_server_sessions';
  end if;
end $$;

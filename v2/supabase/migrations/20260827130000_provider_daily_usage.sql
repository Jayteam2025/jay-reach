-- ============================================================================
-- Consommation quotidienne des providers facturés à l'appel, avec plafond.
--
-- Reoon impose 20 vérifications par jour sur son offre gratuite. Le socle actuel
-- porte un compteur (`daily_reoon_usage`) et une fonction atomique qui refuse le
-- crédit une fois le plafond atteint, plutôt que de laisser partir des appels qui
-- reviendront en erreur. On reprend le mécanisme en le rendant générique : le v2
-- a plusieurs providers facturés, et un plafond ne concerne pas que Reoon.
--
-- Cloisonné par organisation (règle CLAUDE.md #5) : chaque organisation branche
-- ses propres comptes providers et paie ses propres consommations, donc chacune
-- a son plafond.
-- ============================================================================

create table provider_daily_usage (
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_id text not null,
  usage_date date not null default current_date,
  used int not null default 0 check (used >= 0),
  daily_cap int not null check (daily_cap > 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider_id, usage_date)
);

alter table provider_daily_usage enable row level security;
alter table provider_daily_usage force row level security;

-- Lecture seule pour les membres : savoir où en est le quota du jour est utile
-- dans l'écran Fournisseurs. L'écriture reste au service_role, qui contourne la
-- RLS — un client ne doit jamais pouvoir s'octroyer du crédit.
create policy provider_daily_usage_read on public.provider_daily_usage
  for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

-- ---------------------------------------------------------------------------
-- Consomme un crédit et dit si l'appel est autorisé. Atomique : deux workers qui
-- demandent le dernier crédit du jour ne peuvent pas l'obtenir tous les deux.
--
-- Le compteur du jour est créé à la volée. `p_cap` vient de l'appelant (la
-- configuration du provider) et rafraîchit la ligne : relever son plafond chez
-- Reoon prend effet sans migration.
-- ---------------------------------------------------------------------------
create or replace function app.consume_provider_credit(
  p_org uuid, p_provider text, p_cap int, p_count int default 1
) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_used int;
begin
  if p_cap <= 0 or p_count <= 0 then
    return false;
  end if;

  insert into provider_daily_usage (organization_id, provider_id, usage_date, used, daily_cap)
    values (p_org, p_provider, current_date, 0, p_cap)
  on conflict (organization_id, provider_id, usage_date) do update
    set daily_cap = excluded.daily_cap;

  -- `returning` sous le `update` conditionnel : si le plafond est déjà atteint,
  -- aucune ligne n'est mise à jour et v_used reste nul.
  update provider_daily_usage
     set used = used + p_count, updated_at = now()
   where organization_id = p_org and provider_id = p_provider
     and usage_date = current_date
     and used + p_count <= daily_cap
  returning used into v_used;

  return v_used is not null;
end $$;

revoke all on function app.consume_provider_credit(uuid, text, int, int) from public;
grant execute on function app.consume_provider_credit(uuid, text, int, int) to service_role;

comment on table provider_daily_usage is
  'Consommation quotidienne par (organisation, provider), avec plafond. Écrit uniquement via app.consume_provider_credit, qui refuse le crédit au-delà du plafond.';

-- ============================================================================
-- #118 (tour de correction 5, lot 2) : le jour du plafond quotidien de
-- scoring/enrichissement (`provider_daily_usage.usage_date`) était toujours
-- `current_date` (le fuseau du SERVEUR, UTC) — la page Plafonds disait donc,
-- honnêtement mais de façon incohérente pour l'opérateur, que les jauges se
-- remettaient à zéro « à minuit UTC ». Décision de JB du 17/09 (« tout doit
-- être juste et cohérent ») : la journée doit suivre le fuseau de
-- l'organisation, comme toutes les autres jauges (envois, tendances 7 jours).
--
-- `p_usage_date` est un paramètre optionnel additif (défaut `null`, résolu en
-- `current_date` dans la fonction) : les appelants existants qui ne le
-- passent pas (relève Reoon, crédit SalesBlink) gardent EXACTEMENT le même
-- comportement qu'avant cette migration. Seuls le scoring et l'enrichissement
-- (`apps/worker/src/traitements.ts`, `producer.ts`) passent désormais le jour
-- calculé dans le fuseau de l'organisation (`fuseauDeLOrganisation` +
-- `jourCourantDansFuseau`, `packages/core/src/fonctions/plafonds.ts`).
--
-- `drop` puis `create` (et non `create or replace`) : ajouter un paramètre
-- change la signature (le nombre de types d'arguments), Postgres créerait
-- sinon un second overload à 5 paramètres à côté de l'ancien à 4, au lieu de
-- le remplacer — deux fonctions à maintenir pour la même consommation de
-- crédit.
-- ============================================================================

drop function if exists app.consume_provider_credit(uuid, text, int, int);

create function app.consume_provider_credit(
  p_org uuid, p_provider text, p_cap int, p_count int default 1, p_usage_date date default null
) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_used int;
  v_date date := coalesce(p_usage_date, current_date);
begin
  if p_cap <= 0 or p_count <= 0 then
    return false;
  end if;

  insert into provider_daily_usage (organization_id, provider_id, usage_date, used, daily_cap)
    values (p_org, p_provider, v_date, 0, p_cap)
  on conflict (organization_id, provider_id, usage_date) do update
    set daily_cap = excluded.daily_cap;

  -- `returning` sous le `update` conditionnel : si le plafond est déjà atteint,
  -- aucune ligne n'est mise à jour et v_used reste nul.
  update provider_daily_usage
     set used = used + p_count, updated_at = now()
   where organization_id = p_org and provider_id = p_provider
     and usage_date = v_date
     and used + p_count <= daily_cap
  returning used into v_used;

  return v_used is not null;
end $$;

revoke all on function app.consume_provider_credit(uuid, text, int, int, date) from public;
grant execute on function app.consume_provider_credit(uuid, text, int, int, date) to service_role;

comment on function app.consume_provider_credit(uuid, text, int, int, date) is
  'Consomme p_count crédit(s) du jour (p_usage_date, ou current_date si omis) pour (organisation, provider), sans dépasser p_cap.';

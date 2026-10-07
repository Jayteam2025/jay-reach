-- ============================================================================
-- Ce que l'enrichissement COÛTE, et pas seulement combien de fois on l'a appelé.
--
-- `provider_daily_usage` compte des UNITÉS (`used`) et un plafond d'unités
-- (`daily_cap`). Elle ne sait rien du prix. FullEnrich, lui, renvoie le coût
-- réel de chaque job dans `cost.credits` — un nombre fractionnaire, qui dépend
-- de ce qu'il a fallu faire pour trouver l'adresse. Ce nombre était jusqu'ici
-- lu puis jeté : aucune colonne ne pouvait l'accueillir, aucun journal ne le
-- notait, et l'erreur d'écriture était avalée. Résultat : personne ne pouvait
-- dire ce qu'une journée de prospection avait coûté.
--
-- C'est ici que le coût se range, et pas dans une table neuve : même clé
-- (organisation, fournisseur, jour), même granularité que les unités, et
-- l'écran Fournisseurs lit déjà cette ligne — il n'a qu'une colonne de plus à
-- afficher. `numeric` et non `int` : un crédit FullEnrich se facture par
-- fractions.
--
-- Additive et sans défaut surprenant (`default 0`) : les lignes existantes
-- restent lisibles, et un fournisseur qui ne rend aucun coût garde zéro.
-- ============================================================================

alter table provider_daily_usage
  add column if not exists credits_spent numeric not null default 0
    check (credits_spent >= 0);

comment on column provider_daily_usage.credits_spent is
  'Coût réel cumulé du jour, tel que le fournisseur le rend (FullEnrich : cost.credits). Distinct de `used`, qui compte des appels. Écrit par app.record_provider_cost.';

-- ---------------------------------------------------------------------------
-- Ajoute un coût constaté à la ligne du jour.
--
-- Volontairement un simple `update`, JAMAIS un upsert : le crédit a forcément
-- été consommé avant l'appel au fournisseur (`app.consume_provider_credit`),
-- donc la ligne existe. Créer la ligne ici masquerait exactement le défaut
-- qu'on veut voir — un coût qui arrive sans qu'aucun crédit n'ait été
-- décompté, ou sur un autre jour que celui du décompte. Le booléen rendu dit
-- si le coût a trouvé sa ligne ; l'appelant le consigne quand il vaut `false`,
-- au lieu de laisser le chiffre disparaître.
--
-- `p_credits <= 0` rend `false` sans rien écrire : un coût nul n'a rien à
-- ajouter, et un coût négatif n'existe pas. L'appelant distingue déjà « coût
-- absent de la réponse » (qu'il signale) de « coût nul » (qu'il n'envoie pas).
-- ---------------------------------------------------------------------------
create or replace function app.record_provider_cost(
  p_org uuid, p_provider text, p_credits numeric, p_usage_date date default null
) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_date date := coalesce(p_usage_date, current_date);
  v_touche int;
begin
  if p_credits is null or p_credits <= 0 then
    return false;
  end if;

  update provider_daily_usage
     set credits_spent = credits_spent + p_credits, updated_at = now()
   where organization_id = p_org and provider_id = p_provider and usage_date = v_date;

  get diagnostics v_touche = row_count;
  return v_touche > 0;
end $$;

-- `public` et non `anon` seul : EXECUTE est accordé à PUBLIC par défaut sur
-- toute fonction créée, et révoquer `anon` laisserait la fonction ouverte à
-- tout rôle (`=X/` dans l'ACL). Les trois rôles sont nommés pour que la
-- révocation se lise sans connaître ce détail.
revoke all on function app.record_provider_cost(uuid, text, numeric, date) from public, anon, authenticated;
grant execute on function app.record_provider_cost(uuid, text, numeric, date) to service_role;

comment on function app.record_provider_cost(uuid, text, numeric, date) is
  'Ajoute p_credits au coût réel du jour (p_usage_date, ou current_date si omis) pour (organisation, fournisseur). Rend false si aucune ligne du jour n''existe — le crédit n''avait pas été consommé.';

comment on table provider_daily_usage is
  'Consommation quotidienne par (organisation, fournisseur) : unités via app.consume_provider_credit (qui refuse au-delà du plafond), coût réel via app.record_provider_cost.';

-- ---------------------------------------------------------------------------
-- Contrôle : la migration échoue si la colonne ou la fonction manque, et si la
-- fonction reste exécutable par un rôle qui n'y a pas droit.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'provider_daily_usage'
       and column_name = 'credits_spent'
  ) then
    raise exception 'colonne manquante : provider_daily_usage.credits_spent';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'record_provider_cost'
  ) then
    raise exception 'fonction manquante : app.record_provider_cost';
  end if;
  if has_function_privilege('authenticated', 'app.record_provider_cost(uuid, text, numeric, date)', 'execute') then
    raise exception 'app.record_provider_cost reste exécutable par authenticated';
  end if;
end $$;

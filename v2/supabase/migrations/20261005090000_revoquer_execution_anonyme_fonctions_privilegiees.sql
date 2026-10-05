-- Retire aux rôles `anon` et `authenticated` le droit d'exécuter les fonctions
-- SECURITY DEFINER qui ne vérifient pas l'appartenance à l'organisation.
--
-- POURQUOI. Une fonction SECURITY DEFINER s'exécute avec les droits de son
-- propriétaire, donc sans RLS. Trente-trois d'entre elles acceptaient un
-- `organization_id` EN PARAMÈTRE sans jamais vérifier que l'appelant y a droit,
-- tout en étant exécutables par `anon` — c'est-à-dire par quiconque dispose de
-- la clé publique, laquelle est par construction dans le bundle JavaScript du
-- site. Relevé par la revue de sécurité du 05/10/2026, confirmé en base.
--
-- Ce que cela ouvrait, sans aucun compte :
--   * `set_provider_credential` et `merge_provider_config` : écraser les clés
--     d'API de n'importe quelle organisation (SalesBlink, Anthropic, FullEnrich,
--     Microsoft Graph) et lire leurs quatre derniers caractères. Un secret
--     remplacé par une valeur que `ENCRYPTION_KEY` ne déchiffre plus arrête les
--     envois et la relève en silence.
--   * `search_accounts_trgm` : lire les entreprises d'une organisation.
--   * `enfiler_enrichissement` : dépenser le crédit FullEnrich d'autrui.
--   * `save_message_template_version`, `activate_message_template_version`,
--     `move_sequence_step` : écrire dans les messages et les séquences.
--   * `spawn_enrichment_worker`, `spawn_bouncer_sweep` : déclencher un appel
--     HTTP sortant.
--
-- Ce sont des vestiges du socle v1 : le code v2 ne les appelle plus, ou les
-- appelle depuis le serveur via `ctx.ex` (rôle `postgres`), que cette migration
-- n'affecte pas.
--
-- POURQUOI UN BALAYAGE ET NON UNE LISTE. Une première version énumérait les
-- trente-trois `revoke`. Elle échouait sur une base neuve : la moitié de ces
-- fonctions ne fait PAS partie du schéma versionné de ce dépôt — elles n'existent
-- que sur les instances qui portent l'héritage v1. Un `revoke` sur une fonction
-- absente lève, donc la liste aurait cassé toute installation neuve, celle d'un
-- contributeur comprise. Le balayage traite ce qui est présent et ignore le
-- reste ; il a l'avantage supplémentaire de rattraper une fonction du même genre
-- qui apparaîtrait plus tard.
--
-- DEUX EXCEPTIONS, et une seule raison. `create_organization` et
-- `accept_invitation` sont les seules appelées depuis le navigateur
-- (`apps/web/app/actions/org.ts:58` et `:93`, via `supabase.rpc`), par un
-- utilisateur déjà connecté : elles gardent `authenticated` et ne perdent que
-- `anon`. Leur absence de contrôle d'appartenance reste à traiter — elles
-- reçoivent un jeton d'invitation ou créent une organisation neuve, donc le
-- risque est d'une autre nature, mais il n'est pas nul.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS. Elle ne supprime aucune fonction : le
-- dépôt impose de classer avant de retirer, et une révocation se défait d'un
-- `grant` si elle casse quelque chose d'imprévu. Elle ne touche pas non plus les
-- fonctions SECURITY DEFINER qui vérifient déjà l'appartenance via `auth.uid()`
-- ou `app.user_orgs()` : pour un anonyme, `auth.uid()` est NULL et elles ne
-- rendent rien. Elle laisse `service_role` intact, dont le worker dépend.

-- POURQUOI `public` FIGURE DANS LA RÉVOCATION. Postgres accorde EXECUTE à
-- PUBLIC par défaut sur toute fonction (`=X/` en tête de son ACL). Révoquer à
-- `anon` seul ne retire donc rien : le rôle garde le droit par héritage de
-- PUBLIC. Un premier essai a buté exactement là — onze fonctions refermées, sept
-- toujours ouvertes, toutes celles dont l'ACL portait `=X/postgres`. En
-- revanche `service_role` possède un droit EXPLICITE (`service_role=X/postgres`)
-- qu'une révocation à PUBLIC ne touche pas : le worker et les edge functions
-- conservent leur accès.

do $$
declare
  f record;
  revoquees int := 0;
  -- Appelées depuis le navigateur par un utilisateur connecté : elles ne
  -- perdent que `anon`.
  gardent_authenticated constant text[] := array['create_organization', 'accept_invitation'];
begin
  for f in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       -- Sans contrôle d'appartenance dans son propre corps.
       and not (p.prosrc ilike '%user_orgs%' or p.prosrc ilike '%auth.uid%' or p.prosrc ilike '%memberships%')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    if f.proname = any (gardent_authenticated) then
      execute format('revoke all on function public.%I(%s) from public, anon', f.proname, f.args);
    else
      execute format('revoke all on function public.%I(%s) from public, anon, authenticated', f.proname, f.args);
    end if;
    revoquees := revoquees + 1;
  end loop;
  raise notice 'Fonctions privilégiées refermées : %', revoquees;
end $$;

-- Contrôle : plus aucune fonction SECURITY DEFINER sans vérification
-- d'appartenance ne doit rester exécutable par `anon`. Échoue la migration
-- plutôt que de laisser croire qu'elle a tout fermé.
do $$
declare restantes text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into restantes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and not (p.prosrc ilike '%user_orgs%' or p.prosrc ilike '%auth.uid%' or p.prosrc ilike '%memberships%')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if restantes is not null then
    raise exception 'Fonctions SECURITY DEFINER encore exécutables par anon sans contrôle : %', restantes;
  end if;
end $$;

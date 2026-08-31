-- Les compteurs de l'écran LinkedIn en une seule lecture.
--
-- Ils étaient cinq requêtes distinctes sur la même table, avec les mêmes
-- filtres d'organisation. Groupées, elles coûtent un aller-retour au lieu de
-- cinq — ce qui comptait peu tant que la latence était de 3 ms, mais faisait
-- l'écart entre cet écran et les autres.
--
-- SECURITY INVOKER (le défaut) : les politiques de `linkedin_action_queue`
-- s'appliquent telles quelles, sans qu'on ait à les réécrire ici. Une fonction
-- SECURITY DEFINER aurait obligé à revérifier l'appartenance à la main, avec
-- le risque d'oublier — pour aucun gain.
create or replace function public.linkedin_activite(p_org uuid)
returns table (
  en_attente int,
  envoyes_7j int,
  envoyes_24h int,
  restreint int,
  echecs_24h int
)
language sql
stable
set search_path = 'public'
as $$
  select
    count(*) filter (where status = 'pending')::int,
    count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days')::int,
    count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int,
    count(*) filter (
      where status = 'failed'
        and error_code in ('restricted', 'not_logged_in')
        and updated_at > now() - interval '24 hours'
    )::int,
    count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')::int
  from linkedin_action_queue
  where organization_id = p_org;
$$;

comment on function public.linkedin_activite(uuid) is
  'Compteurs de l''écran LinkedIn en une lecture. SECURITY INVOKER : les politiques de la table s''appliquent.';

revoke all on function public.linkedin_activite(uuid) from public;
grant execute on function public.linkedin_activite(uuid) to authenticated;

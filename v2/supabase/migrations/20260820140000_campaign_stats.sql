-- ============================================================================
-- Vue de métriques par campagne (écran Campagnes + base des futures stats T32).
-- `security_invoker` : la vue s'exécute avec les droits de l'appelant, donc la
-- RLS des tables sous-jacentes s'applique (cloisonnement par organisation).
-- ============================================================================
create view public.campaign_stats
with (security_invoker = on)
as
select
  c.id,
  c.organization_id,
  c.name,
  c.status,
  c.source_id,
  (select count(*) from public.enrollments e where e.campaign_id = c.id) as enrolled,
  (select count(*) from public.actions a
     join public.enrollments e on e.id = a.enrollment_id
    where e.campaign_id = c.id and a.status in ('dispatched', 'delivered')) as sent,
  (select count(distinct a.enrollment_id) from public.actions a
     join public.enrollments e on e.id = a.enrollment_id
    where e.campaign_id = c.id and a.status in ('dispatched', 'delivered')) as contacted,
  (select count(*) from public.actions a
     join public.enrollments e on e.id = a.enrollment_id
    where e.campaign_id = c.id and a.channel = 'linkedin_invite') as invites,
  (select count(*) from public.outcomes o
     join public.actions a on a.id = o.action_id
     join public.enrollments e on e.id = a.enrollment_id
    where e.campaign_id = c.id and o.type = 'invite_accepted') as accepted,
  (select count(*) from public.outcomes o
     join public.actions a on a.id = o.action_id
     join public.enrollments e on e.id = a.enrollment_id
    where e.campaign_id = c.id and o.type = 'replied') as replies,
  (select count(distinct s.channel) from public.sequence_steps s where s.campaign_id = c.id) as channels
from public.campaigns c;

grant select on public.campaign_stats to authenticated, service_role;

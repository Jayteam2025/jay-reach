-- ============================================================================
-- Seed — une organisation de démonstration, en données FICTIVES.
-- (Règle CLAUDE.md : aucune vraie personne ni entreprise.)
-- Exécuté par `supabase db reset`, en service_role (RLS contournée).
-- ============================================================================

-- Organisation de démo (id fixe pour être rejouable).
insert into public.organizations (id, name, slug, default_locale)
values ('d0000000-0000-4000-8000-000000000001', 'Atelier Démo SAS', 'atelier-demo', 'fr')
on conflict (id) do nothing;

-- Utilisateur de démo + adhésion owner (best-effort : ne casse pas le seed si
-- la forme de auth.users diffère selon la version de Supabase).
do $$
declare v_user uuid := 'd0000000-0000-4000-8000-0000000000aa';
begin
  begin
    insert into auth.users (id, email) values (v_user, 'demo@atelier-demo.test')
    on conflict (id) do nothing;
  exception when others then
    raise notice 'seed: insertion auth.users ignorée (%).', sqlerrm;
  end;
  begin
    insert into public.memberships (organization_id, user_id, role)
    values ('d0000000-0000-4000-8000-000000000001', v_user, 'owner')
    on conflict do nothing;
  exception when others then
    raise notice 'seed: adhésion démo ignorée (%).', sqlerrm;
  end;
end $$;

-- Persona.
insert into public.personas (id, organization_id, name, description, title_patterns, seniority, angle)
values (
  'd0000000-0000-4000-8000-0000000000b1',
  'd0000000-0000-4000-8000-000000000001',
  'Directeur commercial',
  'Décideurs commerciaux en PME.',
  array['directeur commercial', 'sales director', 'head of sales', 'commercieel directeur'],
  'director',
  'Aider à structurer la prospection sortante sans y passer ses journées.'
) on conflict (id) do nothing;

-- Source de signaux (offres d''emploi).
insert into public.sources (id, organization_id, provider_id, name, config, schedule)
values (
  'd0000000-0000-4000-8000-0000000000c1',
  'd0000000-0000-4000-8000-000000000001',
  'jobboard.francetravail',
  'Offres — commercial itinérant',
  '{"keywords": ["commercial itinérant", "business developer"]}',
  '0 7 * * *'
) on conflict (id) do nothing;

-- Compte (entreprise) fictif.
insert into public.accounts (id, organization_id, name, legal_name, siren, naf_code, domain, headcount, city, postal_code, country, locale)
values (
  'd0000000-0000-4000-8000-0000000000d1',
  'd0000000-0000-4000-8000-000000000001',
  'Société Témoin', 'Société Témoin SA', '000000000', '4690Z', 'societe-temoin.test',
  45, 'Lyon', '69003', 'FR', 'fr'
) on conflict (id) do nothing;

-- Contact fictif rattaché au compte + persona.
insert into public.contacts (id, organization_id, account_id, persona_id, first_name, last_name, job_title, locale, email, email_status)
values (
  'd0000000-0000-4000-8000-0000000000e1',
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-0000000000d1',
  'd0000000-0000-4000-8000-0000000000b1',
  'Alex', 'Martin', 'Directeur commercial', 'fr', 'alex.martin@societe-temoin.test', 'valid'
) on conflict (id) do nothing;

-- Modèle de message (email v1, FR).
insert into public.message_templates (id, organization_id, name, channel, locale, version, subject, body)
values (
  'd0000000-0000-4000-8000-0000000000f1',
  'd0000000-0000-4000-8000-000000000001',
  'Ouverture — offre commerciale', 'email', 'fr', 1,
  'Votre recrutement de {{job_title}}',
  'Bonjour {{first_name}}, j''ai vu que {{company}} recrute…'
) on conflict (id) do nothing;

-- Campagne rattachée à la source + une étape email.
insert into public.campaigns (id, organization_id, name, status, source_id, entry_rules, daily_cap)
values (
  'd0000000-0000-4000-8000-000000000a11',
  'd0000000-0000-4000-8000-000000000001',
  'Signal emploi — commerciaux', 'draft',
  'd0000000-0000-4000-8000-0000000000c1',
  '{"min_score": 60}', 30
) on conflict (id) do nothing;

insert into public.sequence_steps (campaign_id, position, channel, delay_hours, template_parent_id)
values ('d0000000-0000-4000-8000-000000000a11', 1, 'email', 0, 'd0000000-0000-4000-8000-0000000000f1')
on conflict (campaign_id, position) do nothing;

-- Un signal détecté, résolu sur le compte témoin.
insert into public.signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, title, company_hint, account_id, resolution_status, score, status)
values (
  'd0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-0000000000c1',
  'jobboard.francetravail', 'demo-offer-0001', 'job_posting', now() - interval '2 days',
  'Commercial itinérant H/F', 'Société Témoin',
  'd0000000-0000-4000-8000-0000000000d1', 'resolved', 72, 'qualified'
) on conflict (source_id, external_id) do nothing;

-- Quelques signaux supplémentaires pour peupler l'écran Signaux (états variés).
insert into public.signals (organization_id, source_id, provider_id, external_id, kind, occurred_at, title, company_hint, location, resolution_status, score, status)
values
  ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','jobboard.francetravail','demo-offer-0002','job_posting', now() - interval '1 days','Business Developer','Entreprise Alpha','Paris (75)','resolved', 78, 'new'),
  ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','jobboard.adzuna','demo-offer-0003','job_posting', now() - interval '3 days','Directeur Commercial','Groupe Meridian','Nantes (44)','resolved', 88, 'new'),
  ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','jobboard.francetravail','demo-offer-0004','job_posting', now() - interval '2 days','Chargé de développement','Fabrique du Sud','Marseille (13)','unresolved', 61, 'new'),
  ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000c1','jobboard.francetravail','demo-offer-0005','job_posting', now() - interval '5 days','Consultant en recrutement','Cabinet Durand Conseil','Bordeaux (33)','resolved', 12, 'discarded')
on conflict (source_id, external_id) do nothing;

update public.signals set discard_reason = 'recruiter' where external_id = 'demo-offer-0005'
  and organization_id = 'd0000000-0000-4000-8000-000000000001';

-- Étapes supplémentaires + une inscription active (pour peupler la fiche Prospect).
insert into public.sequence_steps (campaign_id, position, channel, delay_hours, template_parent_id)
values
  ('d0000000-0000-4000-8000-000000000a11', 2, 'linkedin_invite', 48, null),
  ('d0000000-0000-4000-8000-000000000a11', 3, 'email', 72, 'd0000000-0000-4000-8000-0000000000f1')
on conflict (campaign_id, position) do nothing;

insert into public.enrollments (organization_id, campaign_id, contact_id, status, current_step, next_action_at, started_at)
values ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000a11','d0000000-0000-4000-8000-0000000000e1','active',1, now(), now())
on conflict (contact_id) where status in ('active','paused','paused_absence') do nothing;

-- Activité de démonstration pour l'écran Campagnes.
-- Activité de démonstration pour l'écran Campagnes (contacts, inscriptions,
-- actions envoyées, résultats) — chiffres réalistes, données fictives.
do $$
declare
  v_org uuid := 'd0000000-0000-4000-8000-000000000001';
  v_camp uuid := 'd0000000-0000-4000-8000-000000000a11';
  v_acc uuid := 'd0000000-0000-4000-8000-0000000000d1';
  v_contact uuid; v_enr uuid; v_action uuid; i int;
begin
  update public.campaigns set status='active' where id=v_camp;
  for i in 1..12 loop
    if exists (select 1 from public.contacts where organization_id=v_org and email='demo-camp-'||i||'@societe-temoin.test') then
      continue;
    end if;
    insert into public.contacts (organization_id, account_id, first_name, last_name, job_title, locale, email, email_status, linkedin_url)
    values (v_org, v_acc, 'Prospect', 'Démo '||i, 'Responsable commercial', 'fr', 'demo-camp-'||i||'@societe-temoin.test', 'valid',
            case when i % 2 = 0 then 'https://www.linkedin.com/in/prospect-demo-'||i else null end)
    returning id into v_contact;
    insert into public.enrollments (organization_id, campaign_id, contact_id, status, current_step, next_action_at, started_at)
    values (v_org, v_camp, v_contact, 'active', 1, now(), now() - (i||' hours')::interval)
    returning id into v_enr;
    insert into public.actions (organization_id, enrollment_id, channel, status, scheduled_for, dispatched_at, idempotency_key)
    values (v_org, v_enr, 'email', 'dispatched', now(), now(), v_enr::text||':email:0')
    returning id into v_action;
    insert into public.outcomes (action_id, type, occurred_at) values (v_action, 'sent', now());
    if i % 5 = 0 then
      insert into public.outcomes (action_id, type, occurred_at) values (v_action, 'replied', now());
    end if;
    if i % 2 = 0 then
      insert into public.actions (organization_id, enrollment_id, channel, status, scheduled_for, dispatched_at, idempotency_key)
      values (v_org, v_enr, 'linkedin_invite', 'dispatched', now(), now(), v_enr::text||':li:0')
      returning id into v_action;
      if i % 4 = 0 then
        insert into public.outcomes (action_id, type, occurred_at) values (v_action, 'invite_accepted', now());
      end if;
    end if;
  end loop;
end $$;

-- Réception : sender + fils de démonstration.
-- Réception : un sender email + trois fils de démonstration (données fictives).
do $$
declare
  v_org uuid := 'd0000000-0000-4000-8000-000000000001';
  c_alex uuid; c_a uuid; c_b uuid; t1 uuid; t2 uuid; t3 uuid;
begin
  if not exists (select 1 from public.senders where organization_id=v_org and identity='elise@atelier-demo.test') then
    insert into public.senders (organization_id, kind, identity, display_name, is_active)
    values (v_org, 'email', 'elise@atelier-demo.test', 'Élise', true);
  end if;

  select id into c_alex from public.contacts where organization_id=v_org and email='alex.martin@societe-temoin.test';
  select id into c_a from public.contacts where organization_id=v_org and email='demo-camp-5@societe-temoin.test';
  select id into c_b from public.contacts where organization_id=v_org and email='demo-camp-2@societe-temoin.test';

  if not exists (select 1 from public.threads where organization_id=v_org and provider_thread_id='demo-thread-1') then
    insert into public.threads (organization_id, contact_id, channel, provider_thread_id, last_message_at, is_read, classification)
    values (v_org, c_alex, 'email', 'demo-thread-1', now() - interval '2 hours', false, 'human_reply') returning id into t1;
    insert into public.thread_messages (thread_id, direction, body, sent_at) values
      (t1, 'out', 'Bonjour Alex, j''ai vu que Société Témoin recrute des commerciaux — une phase de croissance ?', now() - interval '1 day'),
      (t1, 'in', 'Intéressant, on peut en parler jeudi ? Plutôt en fin de journée si possible.', now() - interval '2 hours');
  end if;

  if c_a is not null and not exists (select 1 from public.threads where organization_id=v_org and provider_thread_id='demo-thread-2') then
    insert into public.threads (organization_id, contact_id, channel, provider_thread_id, last_message_at, is_read, classification, resume_at)
    values (v_org, c_a, 'email', 'demo-thread-2', now() - interval '1 day', false, 'auto_absence', now() + interval '6 days') returning id into t2;
    insert into public.thread_messages (thread_id, direction, body, sent_at) values
      (t2, 'out', 'Bonjour, seriez-vous disponible pour un échange rapide cette semaine ?', now() - interval '2 days'),
      (t2, 'in', 'Je suis absent jusqu''au 26 août, je reviendrai vers vous à mon retour.', now() - interval '1 day');
  end if;

  if c_b is not null and not exists (select 1 from public.threads where organization_id=v_org and provider_thread_id='demo-thread-3') then
    insert into public.threads (organization_id, contact_id, channel, provider_thread_id, last_message_at, is_read, classification)
    values (v_org, c_b, 'linkedin_message', 'demo-thread-3', now() - interval '3 hours', false, 'auto_left_company') returning id into t3;
    insert into public.thread_messages (thread_id, direction, body, sent_at) values
      (t3, 'out', 'Bonjour, ravi de vous connecter suite à votre annonce.', now() - interval '2 days'),
      (t3, 'in', 'Je ne suis plus en poste dans cette entreprise depuis le mois dernier.', now() - interval '3 hours');
  end if;
end $$;

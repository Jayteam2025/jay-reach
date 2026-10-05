-- Jeu d'essai de la population globale des contacts (lot 2, P4). Données synthétiques.
-- Pensé pour mordre là où une réécriture en SQL peut diverger de l'ancienne boucle en mémoire :
--   * des contacts candidats à PLUSIEURS campagnes (même signal => même instant dans chaque
--     campagne : égalité d'instant systématique, donc départage par nom de campagne) ;
--   * des instants partagés par beaucoup de contacts (le départage final par contact_id compte) ;
--   * des contacts inscrits ici et candidats là, avec des statuts d'inscription différents ;
--   * des inscrits SANS signal (instant = début d'inscription, égalités volontaires) ;
--   * une campagne sans étape, des suppressions, un fil « intéressé », un contact à ne plus contacter ;
--   * une seconde organisation (aucune fuite attendue).
\set ON_ERROR_STOP on
reset role;

insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org contacts globaux', 'org-contacts-globaux'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Autre org contacts globaux', 'autre-org-contacts-globaux');

insert into sources (id, organization_id, provider_id, name, is_active) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'adzuna', 'Source A', true),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'francetravail', 'Source B', true),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'adzuna', 'Source autre org', true);

-- Noms choisis pour que l'ordre alphabétique != l'ordre des uuid.
insert into campaigns (id, organization_id, name, status, source_id, entry_rules) values
  ('c4000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alpha',   'active', 'a1000000-0000-0000-0000-000000000001', '{}'),
  ('c3000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Bravo',   'active', 'a1000000-0000-0000-0000-000000000001', '{}'),
  ('c2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Charlie', 'active', 'a1000000-0000-0000-0000-000000000002', '{}'),
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Delta',   'draft',  'a1000000-0000-0000-0000-000000000001', '{}'),
  ('cb000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Autre',   'active', 'b1000000-0000-0000-0000-000000000001', '{}');

-- Alpha, Bravo, Delta ciblent la source A ; Bravo ET Charlie ciblent la source B.
insert into campaign_sources (campaign_id, source_id) values
  ('c4000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('cb000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');

-- Alpha 3 étapes, Bravo 1, Charlie 0, Delta 2 (la borne d'étape affichée dépend de la campagne représentative).
insert into sequence_steps (campaign_id, position, channel, delay_hours)
select c, p, 'email', 0 from (values
  ('c4000000-0000-0000-0000-000000000001'::uuid, 0), ('c4000000-0000-0000-0000-000000000001', 1), ('c4000000-0000-0000-0000-000000000001', 2),
  ('c3000000-0000-0000-0000-000000000001', 0),
  ('c1000000-0000-0000-0000-000000000001', 0), ('c1000000-0000-0000-0000-000000000001', 1)
) v(c, p);

-- 600 signaux : 300 sur la source A, 300 sur la B. 40 instants distincts seulement (15 signaux par instant).
-- Un signal sur 10 est écarté (`discarded`), un sur 25 reste `new` (exclu de la population).
insert into signals (id, organization_id, source_id, provider_id, external_id, kind, occurred_at, title, company_hint, score, status)
select
  ('5e000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001',
  case when i % 2 = 0 then 'a1000000-0000-0000-0000-000000000001'::uuid else 'a1000000-0000-0000-0000-000000000002'::uuid end,
  case when i % 2 = 0 then 'adzuna' else 'francetravail' end,
  'ext-' || i,
  'job_posting',
  timestamptz '2026-09-01 08:00:00+00' + ((i % 40) * interval '3 hours'),
  'Offre ' || i,
  'Entreprise ' || (i % 50),
  (i * 7) % 101,
  case when i % 25 = 0 then 'new'::signal_status when i % 10 = 0 then 'discarded' else 'qualified' end
from generate_series(1, 600) i;

insert into signals (id, organization_id, source_id, provider_id, external_id, kind, occurred_at, status)
values ('5e000000-0000-0000-0000-ffffffffffff', 'bbbbbbbb-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'adzuna', 'ext-autre', 'job_posting', now(), 'qualified');

-- 600 contacts issus de ces signaux + 60 contacts SANS signal (inscription manuelle) + 1 dans l'autre org.
insert into contacts (id, organization_id, first_name, last_name, job_title, email, email_status, source_signal_id, status)
select
  ('c0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001',
  case when i % 13 = 0 then null else 'Prenom' || i end,
  case when i % 17 = 0 then null else 'Nom' || (i % 90) end,
  'Poste ' || (i % 7),
  case when i % 10 in (0, 1, 2) then null else 'p' || i || '@exemple' || (i % 5) || '.test' end,
  case when i % 10 in (3, 4) then 'unknown'::email_status else 'valid' end,
  ('5e000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  case when i % 41 = 0 then 'do_not_contact'::contact_status else 'active' end
from generate_series(1, 600) i;

insert into contacts (id, organization_id, first_name, last_name, email, email_status)
select
  ('c0000000-0000-0000-0000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Manuel' || i, 'Inscrit' || (i % 9), 'manuel' || i || '@liste.test', 'valid'
from generate_series(1, 60) i;

insert into contacts (id, organization_id, first_name, last_name, source_signal_id)
values ('c0000000-0000-0000-0000-00000000f001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Voisin', 'Autre', '5e000000-0000-0000-0000-ffffffffffff');

-- Inscriptions des contacts à signal : dans Alpha (i % 4 = 0) et Charlie (i % 6 = 0), statuts variés.
-- Un contact à la fois dans Alpha et Charlie a deux statuts différents (jamais deux « en cours » : index unique).
insert into enrollments (organization_id, campaign_id, contact_id, signal_id, status, current_step, started_at, next_action_at, stop_reason, resume_at)
select
  'aaaaaaaa-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001',
  ('c0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  ('5e000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  (array['active','paused','completed','stopped','replied','bounced','paused_absence','active'])[1 + (i / 4) % 8]::enrollment_status,
  (i / 4) % 5,
  timestamptz '2026-09-20 09:00:00+00' + ((i % 5) * interval '1 hour'),
  timestamptz '2026-10-01 09:00:00+00',
  case when (i / 4) % 8 in (1, 3) then 'motif-' || i else null end,
  timestamptz '2026-10-05 09:00:00+00'
from generate_series(4, 600, 4) i;

insert into enrollments (organization_id, campaign_id, contact_id, signal_id, status, current_step, started_at)
select
  'aaaaaaaa-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001',
  ('c0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  ('5e000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  (array['completed','stopped','replied','bounced'])[1 + (i / 6) % 4]::enrollment_status,
  (i / 6) % 4,
  timestamptz '2026-09-25 10:00:00+00' + ((i % 3) * interval '1 hour')
from generate_series(6, 600, 6) i;

-- Inscrits sans signal, dans Delta puis certains aussi dans Bravo : instants d'inscription partagés (3 valeurs).
insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, started_at)
select
  'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
  ('c0000000-0000-0000-0000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
  (array['active','completed','paused','replied'])[1 + i % 4]::enrollment_status,
  i % 3,
  timestamptz '2026-09-28 12:00:00+00' + ((i % 3) * interval '1 day')
from generate_series(1, 60) i;

insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, started_at)
select
  'aaaaaaaa-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
  ('c0000000-0000-0000-0000-' || lpad((1000 + i)::text, 12, '0'))::uuid,
  'completed', 1,
  timestamptz '2026-09-28 12:00:00+00' + ((i % 3) * interval '1 day')
from generate_series(1, 60, 5) i;

-- Suppressions (email et domaine), un fil « intéressé ».
insert into suppressions (organization_id, scope, value) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'email', 'p5@exemple0.test'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'domain', 'exemple4.test');

insert into threads (organization_id, contact_id, channel, interest)
select 'aaaaaaaa-0000-0000-0000-000000000001', ('c0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'email', 'interested'
from generate_series(33, 600, 33) i;

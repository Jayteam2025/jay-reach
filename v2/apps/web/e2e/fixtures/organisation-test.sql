-- Fixture d'organisation de test pour les parcours Playwright (tâche 26).
--
-- Ne crée PAS l'utilisateur `auth.users` : il est créé à part (API
-- d'administration Supabase) par qui applique cette fixture, qui doit passer
-- son identifiant en variable psql :
--
--   psql "$DATABASE_URL" -v e2e_user_id="'<uuid-de-l-utilisateur-de-test>'" \
--     -f apps/web/e2e/fixtures/organisation-test.sql
--
-- Idempotente (rejouable sans dupliquer) : toutes les lignes ont un id fixe
-- et s'écrivent en `insert ... on conflict (id) do update`. Ne touche à
-- aucune donnée réelle : aucune clé de fournisseur, aucune boîte d'envoi,
-- aucun contact réel — uniquement des lignes fictives (domaines
-- example.com/example.org) sous une organisation dédiée, jamais utilisée par
-- le moteur de production en dehors des passages qu'un parcours e2e
-- déclenche explicitement (aucun ici : la campagne reste en brouillon, sans
-- source rattachée par cette fixture, et aucun `run_requested_at` n'est posé).
--
-- Tables touchées : organizations, memberships, campaigns, contacts, threads,
-- thread_messages.

begin;

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------
insert into organizations (id, name, slug, default_locale)
values ('e2e00000-0000-0000-0000-000000000001', 'Recette e2e', 'recette-e2e', 'fr')
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  default_locale = excluded.default_locale;

-- ---------------------------------------------------------------------------
-- Adhésion de l'utilisateur de test (rôle admin : requis par
-- `creerCampagneComplete`, `archiver`, et par l'écran Plafonds pour éditer
-- une ligne).
-- ---------------------------------------------------------------------------
insert into memberships (organization_id, user_id, role)
values ('e2e00000-0000-0000-0000-000000000001', :'e2e_user_id'::uuid, 'admin')
on conflict (organization_id, user_id) do update set role = excluded.role;

-- ---------------------------------------------------------------------------
-- Une campagne en brouillon, sans source ni boîte d'envoi rattachée (le
-- parcours « sources » lui en ajoute une par l'écran ; jamais lancée).
-- ---------------------------------------------------------------------------
insert into campaigns (id, organization_id, name, status, entry_rules, daily_cap, approval_policy)
values (
  'e2e00000-0000-0000-0000-000000000002',
  'e2e00000-0000-0000-0000-000000000001',
  'Campagne e2e',
  'draft',
  '{}',
  30,
  '{}'
)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status;

-- ---------------------------------------------------------------------------
-- Trois contacts inventés (domaines example.com/example.org, personne réelle
-- jamais nommée).
-- ---------------------------------------------------------------------------
insert into contacts (id, organization_id, first_name, last_name, job_title, email, email_status, status)
values
  ('e2e00000-0000-0000-0000-000000000011', 'e2e00000-0000-0000-0000-000000000001', 'Camille', 'Durand', 'Directrice commerciale', 'camille.durand@example.com', 'valid', 'active'),
  ('e2e00000-0000-0000-0000-000000000012', 'e2e00000-0000-0000-0000-000000000001', 'Hugo', 'Lefevre', 'Responsable des ventes', 'hugo.lefevre@example.org', 'valid', 'active'),
  ('e2e00000-0000-0000-0000-000000000013', 'e2e00000-0000-0000-0000-000000000001', 'Ines', 'Petit', 'Cheffe des ventes', 'ines.petit@example.com', 'valid', 'active')
on conflict (id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  job_title = excluded.job_title,
  email = excluded.email,
  email_status = excluded.email_status,
  status = excluded.status;

-- ---------------------------------------------------------------------------
-- Un fil « à traiter » (classification human_reply, handled_at nul) pour le
-- premier contact — le parcours « reception » l'ouvre. Pas de transport
-- (`email_transport_bindings`) : répondre depuis l'application doit rester
-- impossible, aucun envoi ne doit pouvoir partir depuis ce fil de fixture.
-- ---------------------------------------------------------------------------
insert into threads (id, organization_id, contact_id, channel, classification, handled_at, is_read, last_message_at)
values (
  'e2e00000-0000-0000-0000-000000000021',
  'e2e00000-0000-0000-0000-000000000001',
  'e2e00000-0000-0000-0000-000000000011',
  'email',
  'human_reply',
  null,
  false,
  now()
)
on conflict (id) do update set
  classification = excluded.classification,
  handled_at = excluded.handled_at,
  last_message_at = excluded.last_message_at;

insert into thread_messages (id, thread_id, direction, body, sent_at)
values (
  'e2e00000-0000-0000-0000-000000000031',
  'e2e00000-0000-0000-0000-000000000021',
  'in',
  'Bonjour, votre message m''intéresse, pouvez-vous m''en dire plus ?',
  now()
)
on conflict (id) do update set
  body = excluded.body,
  sent_at = excluded.sent_at;

commit;

-- ---------------------------------------------------------------------------
-- Nettoyage (à exécuter à la main, jamais par ce script) : retire toute la
-- fixture, dans l'ordre inverse des dépendances. Ne supprime PAS
-- l'utilisateur `auth.users`, créé à part.
-- ---------------------------------------------------------------------------
-- begin;
-- delete from thread_messages where id = 'e2e00000-0000-0000-0000-000000000031';
-- delete from threads where id = 'e2e00000-0000-0000-0000-000000000021';
-- delete from contacts where id in (
--   'e2e00000-0000-0000-0000-000000000011',
--   'e2e00000-0000-0000-0000-000000000012',
--   'e2e00000-0000-0000-0000-000000000013'
-- );
-- delete from campaign_sources where campaign_id = 'e2e00000-0000-0000-0000-000000000002';
-- delete from campaigns where id = 'e2e00000-0000-0000-0000-000000000002';
-- delete from memberships where organization_id = 'e2e00000-0000-0000-0000-000000000001' and user_id = :'e2e_user_id'::uuid;
-- delete from organizations where id = 'e2e00000-0000-0000-0000-000000000001';
-- commit;

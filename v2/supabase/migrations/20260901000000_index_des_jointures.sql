-- Index sur les clés étrangères que le produit interroge.
--
-- Une clé étrangère sans index oblige Postgres à parcourir toute la table à
-- chaque jointure — et à chaque suppression en cascade dans la table parente.
-- Invisible sur 3 200 signaux, coûteux à cent mille.
--
-- Ne sont indexées QUE les colonnes que le code v2 joint ou filtre réellement.
-- Les tables héritées du socle v1 (`prospect_*`, `workspace_*`) en ont aussi,
-- mais personne ne les lit : les indexer ferait payer l'écriture pour rien.
--
-- `organization_id` revient partout : c'est le filtre de toutes les politiques
-- de sécurité, donc la colonne la plus sollicitée de la base.

-- Lu à chaque page, pour résoudre l'organisation de l'utilisateur.
create index if not exists memberships_user_idx on memberships (user_id);

-- Filtre des politiques de sécurité, sur les tables que les écrans lisent.
create index if not exists campaigns_org_idx on campaigns (organization_id);
create index if not exists sources_org_idx on sources (organization_id);
create index if not exists senders_org_idx on senders (organization_id);
create index if not exists personas_org_idx on personas (organization_id);
create index if not exists enrollments_org_idx on enrollments (organization_id);
create index if not exists threads_org_idx on threads (organization_id);
create index if not exists lists_org_idx on lists (organization_id);
create index if not exists imports_org_idx on imports (organization_id);
create index if not exists customer_lists_org_idx on customer_lists (organization_id);
create index if not exists notifications_org_idx on notifications (organization_id);
create index if not exists extension_tokens_org_idx on extension_tokens (organization_id);
create index if not exists audit_events_org_idx on audit_events (organization_id);

-- Jointures du séquenceur : une action remonte à son inscription, son étape,
-- son expéditeur et son modèle à chaque tick.
create index if not exists actions_enrollment_idx on actions (enrollment_id);
create index if not exists actions_step_idx on actions (step_id);
create index if not exists actions_sender_idx on actions (sender_id);
create index if not exists actions_template_idx on actions (template_id);
create index if not exists actions_approved_by_idx on actions (approved_by);

-- Jointures des écrans : la fiche prospect part du compte, la boîte de
-- réception part du fil.
create index if not exists contacts_account_idx on contacts (account_id);
create index if not exists contacts_persona_idx on contacts (persona_id);
create index if not exists contacts_source_signal_idx on contacts (source_signal_id);
create index if not exists contacts_source_list_idx on contacts (source_list_id);
create index if not exists signals_account_idx on signals (account_id);
create index if not exists threads_contact_idx on threads (contact_id);
create index if not exists thread_messages_thread_idx on thread_messages (thread_id);
create index if not exists list_members_contact_idx on list_members (contact_id);

-- Entrée en campagne et suivi des collectes.
create index if not exists enrollments_campaign_idx on enrollments (campaign_id);
create index if not exists enrollments_signal_idx on enrollments (signal_id);
create index if not exists enrollments_list_idx on enrollments (list_id);
create index if not exists campaigns_source_idx on campaigns (source_id);
create index if not exists campaigns_list_idx on campaigns (list_id);
create index if not exists source_runs_source_idx on source_runs (source_id);
create index if not exists sequence_steps_template_idx on sequence_steps (template_parent_id);

-- Notifications et jetons, lus par utilisateur.
create index if not exists notifications_user_idx on notifications (user_id);
create index if not exists extension_tokens_user_idx on extension_tokens (user_id);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Résolution de la campagne Smartlead par persona, à chaque envoi email.
create index if not exists smartlead_mappings_persona_idx on smartlead_campaign_mappings (persona_id);

-- ============================================================================
-- Reprise des données du socle actuel vers le nouveau schéma (issue #17).
--
-- Condition de bascule, pas une option : un opérateur qui a des mois de
-- prospection derrière lui ne doit pas repartir d'une base vierge.
--
-- Trois principes tenus par ce script :
--
--  1. **Idempotent.** Chaque objet repris laisse une trace dans
--     `legacy_migration_map`. Rejouer la migration ne crée rien en double, et
--     une reprise interrompue se relance telle quelle.
--  2. **N'écrase rien.** Le nouveau schéma peut déjà contenir des données —
--     c'est le cas dès qu'on y a fait tourner une recette. Le script ajoute, il
--     ne met jamais à jour l'existant.
--  3. **Ne fabrique rien.** Ce qui n'a pas d'équivalent structurel n'est pas
--     inventé : voir la note en fin de fichier sur `prospect_actions`.
--
-- Les identifiants cibles sont tirés AVANT l'insertion, et non retrouvés après
-- coup par une jointure sur le nom ou l'adresse : deux entreprises homonymes,
-- ou deux modèles au même objet, se seraient mélangés sans que rien ne le dise.
--
-- L'opérateur crée son organisation par le parcours normal de l'application,
-- puis appelle la fonction en désignant le workspace d'origine. Rattacher à une
-- organisation existante plutôt que d'en créer une évite les doublons chez
-- quelqu'un qui a déjà commencé à configurer le nouveau socle.
-- ============================================================================

create table if not exists legacy_migration_map (
  legacy_table text not null,
  legacy_id    text not null,
  new_id       uuid not null,
  migrated_at  timestamptz not null default now(),
  primary key (legacy_table, legacy_id)
);

comment on table legacy_migration_map is
  'Correspondance entre les identifiants du socle v1 et ceux du nouveau schéma. '
  'C''est ce qui rend la reprise rejouable sans rien dupliquer.';

alter table legacy_migration_map enable row level security;

-- Table technique de reprise : lisible par les administrateurs, jamais écrite
-- depuis l'application (seule la fonction de migration y touche).
drop policy if exists legacy_migration_map_read on legacy_migration_map;
create policy legacy_migration_map_read on legacy_migration_map
  for select using (
    exists (select 1 from memberships m
             where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );

-- Le socle v1 liste plusieurs niveaux de séniorité par persona, la cible n'en
-- accepte qu'un : on retient le plus élevé, celui qui décide de l'angle du
-- message. Les libellés diffèrent d'un schéma à l'autre (« C-level » contre
-- « executive »), d'où la table de correspondance explicite.
create or replace function app.legacy_seniority(p_niveaux text[])
returns seniority_level
language sql
immutable
as $$
  select case
    when p_niveaux && array['C-level', 'Founder', 'CEO', 'Executive'] then 'executive'::seniority_level
    when p_niveaux && array['Director', 'VP', 'Head'] then 'director'::seniority_level
    when p_niveaux && array['Manager', 'Lead'] then 'manager'::seniority_level
    when coalesce(array_length(p_niveaux, 1), 0) > 0 then 'individual'::seniority_level
    else null
  end
$$;

comment on function app.legacy_seniority(text[]) is
  'Traduit les niveaux de séniorité du socle v1 vers l''enum cible. Le socle en '
  'liste plusieurs par persona, la cible n''en accepte qu''un : on retient le plus élevé.';

-- ============================================================================
-- Reprise d'un workspace vers une organisation existante.
-- Renvoie un rapport table par table.
-- ============================================================================
create or replace function app.migrate_legacy_workspace(
  p_workspace uuid,
  p_organization uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $$
declare
  v_rapport jsonb := '{}'::jsonb;
  v_n int;
begin
  if not exists (select 1 from organizations where id = p_organization) then
    raise exception 'Organisation cible introuvable : %', p_organization;
  end if;

  -- ---------------------------------------------------------------- membres
  -- Le socle v1 ne connaît que le rôle `owner`. Toute autre valeur est ramenée
  -- au rôle le plus restreint qui permette de travailler : mieux vaut réhausser
  -- un droit à la main que d'en accorder un de trop.
  insert into memberships (organization_id, user_id, role)
  select p_organization, wm.user_id,
         case wm.role when 'owner' then 'owner'::membership_role
                      when 'admin' then 'admin'::membership_role
                      else 'operator'::membership_role end
    from workspace_members wm
   where wm.workspace_id = p_workspace
     on conflict (organization_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('memberships', v_n);

  -- --------------------------------------------------------------- personas
  with source as (
    select p.*, gen_random_uuid() as new_id
      from icp_personas p
     where p.workspace_id = p_workspace
       and not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'icp_personas' and m.legacy_id = p.id::text)
  ), insere as (
    insert into personas (id, organization_id, name, description, title_patterns, title_exclusions,
                          seniority, department_patterns, scoring_prompt, channels_priority, is_active)
    select s.new_id, p_organization,
           coalesce(nullif(s.label, ''), s.slug, 'Persona importé'),
           s.description,
           coalesce(s.job_title_keywords, '{}'),
           coalesce(s.exclude_titles, '{}'),
           app.legacy_seniority(s.seniority_levels),
           coalesce(s.department_patterns, '{}'),
           s.persona_scoring_prompt,
           coalesce(s.channels_priority, '{}'),
           coalesce(s.is_active, true)
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'icp_personas', s.id::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('personas', v_n);

  -- ---------------------------------------------------------------- modèles
  -- Le socle v1 ne nomme pas ses modèles : on en fabrique un lisible plutôt que
  -- de laisser une liste de lignes anonymes à l'écran.
  with source as (
    select t.*, gen_random_uuid() as new_id
      from prospect_message_templates t
     where t.workspace_id = p_workspace
       and coalesce(t.body, '') <> ''
       and not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'prospect_message_templates' and m.legacy_id = t.id::text)
  ), insere as (
    insert into message_templates (id, organization_id, name, channel, locale, version, subject, body, is_active)
    select s.new_id, p_organization,
           'Modèle importé — ' || coalesce(nullif(s.subject, ''), s.channel),
           s.channel::channel_kind,
           'fr',
           coalesce(s.version, 1),
           s.subject,
           s.body,
           coalesce(s.is_active, true)
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'prospect_message_templates', s.id::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('message_templates', v_n);

  -- ------------------------------------------------- mapping Smartlead
  -- Le socle v1 ne stocke pas des campagnes au sens du nouveau schéma : sa table
  -- `smartlead_campaigns` associe un persona à une campagne Smartlead, et la
  -- cible a exactement la même chose sous `smartlead_campaign_mappings`.
  --
  -- En faire des `campaigns` fabriquerait des campagnes sans source ni liste, ce
  -- que la contrainte `campaigns_one_source` refuse à juste titre : une campagne
  -- sans vivier n'enrôlerait jamais personne, et encombrerait l'écran d'objets
  -- qui ne servent à rien.
  with source as (
    select c.*, gen_random_uuid() as new_id
      from smartlead_campaigns c
     where c.workspace_id = p_workspace
       and not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'smartlead_campaigns' and m.legacy_id = c.id::text)
  ), insere as (
    insert into smartlead_campaign_mappings (id, organization_id, persona_id, campaign_id, campaign_name, enabled)
    select s.new_id, p_organization,
           (select m.new_id from legacy_migration_map m
             where m.legacy_table = 'icp_personas' and m.legacy_id = s.persona_id::text),
           s.campaign_id::text, s.campaign_name, coalesce(s.enabled, false)
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'smartlead_campaigns', s.id::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('smartlead_mappings', v_n);

  -- ---------------------------------------------------------------- comptes
  -- Une ligne v1 mélange l'entreprise et la personne ; la cible les sépare.
  -- `company_group_id` est la clé de regroupement, et ce sont les données qui
  -- l'ont désignée : sur la base de référence, elle donne exactement autant de
  -- groupes que de noms d'entreprise distincts, sans aucun groupe à cheval sur
  -- deux entreprises. Le SIREN ne pouvait pas servir, renseigné sur 2 lignes
  -- sur 55 ; il est repris quand il existe, mais ne regroupe rien.
  with groupes as (
    select p.company_group_id as gid,
           min(p.company_name)   as nom,
           min(p.company_siren)  filter (where p.company_siren  is not null) as siren,
           min(p.company_city)   filter (where p.company_city   is not null) as ville,
           min(p.company_sector) filter (where p.company_sector is not null) as secteur,
           gen_random_uuid()     as new_id
      from prospect_profiles p
     where p.workspace_id = p_workspace
       and p.deleted_at is null
       and p.company_group_id is not null
     group by p.company_group_id
  ), source as (
    select g.* from groupes g
     where not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'prospect_profiles.company_group_id'
                          and m.legacy_id = g.gid::text)
  ), insere as (
    insert into accounts (id, organization_id, name, siren, city, enrichment, resolution_status)
    select s.new_id, p_organization, s.nom, s.siren, s.ville,
           case when s.secteur is null then '{}'::jsonb
                else jsonb_build_object('secteur_v1', s.secteur) end,
           'resolved'::signal_resolution
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'prospect_profiles.company_group_id', s.gid::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('accounts', v_n);

  -- --------------------------------------------------------------- contacts
  -- `deliverability_status` du socle v1 porte déjà exactement les valeurs de
  -- l'enum cible (valid, risky, invalid, role, unknown) : aucune traduction.
  with source as (
    select p.*, gen_random_uuid() as new_id
      from prospect_profiles p
     where p.workspace_id = p_workspace
       and p.deleted_at is null
       and not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'prospect_profiles' and m.legacy_id = p.id::text)
  ), insere as (
    insert into contacts (id, organization_id, account_id, persona_id, first_name, last_name,
                          job_title, email, email_status, linkedin_url, enrichment, status)
    select s.new_id, p_organization,
           (select m.new_id from legacy_migration_map m
             where m.legacy_table = 'prospect_profiles.company_group_id'
               and m.legacy_id = s.company_group_id::text),
           (select m.new_id from legacy_migration_map m
             where m.legacy_table = 'icp_personas' and m.legacy_id = s.persona_id::text),
           s.first_name, s.last_name, s.job_title, s.email,
           coalesce(s.deliverability_status, 'unknown')::email_status,
           s.linkedin_url,
           coalesce(s.enrichment_data, '{}'::jsonb),
           'active'::contact_status
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'prospect_profiles', s.id::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('contacts', v_n);

  -- ---------------------------------------------------------------- signaux
  with source as (
    select s.*, gen_random_uuid() as new_id
      from prospect_signals s
     where s.workspace_id = p_workspace
       and not exists (select 1 from legacy_migration_map m
                        where m.legacy_table = 'prospect_signals' and m.legacy_id = s.id::text)
  ), insere as (
    insert into signals (id, organization_id, provider_id, external_id, kind, occurred_at,
                         raw, url, company_hint, status, account_id)
    select s.new_id, p_organization,
           coalesce(s.source, 'legacy'),
           'legacy:' || s.id::text,
           'job_posting'::signal_kind,
           coalesce(s.detected_at, s.created_at, now()),
           coalesce(s.extracted_data, '{}'::jsonb),
           s.source_url,
           s.company_name,
           case s.status when 'raw'     then 'new'::signal_status
                         when 'matched' then 'qualified'::signal_status
                         else 'discarded'::signal_status end,
           (select m.new_id from legacy_migration_map m
              join prospect_profiles pp on pp.id = s.matched_prospect_id
             where m.legacy_table = 'prospect_profiles.company_group_id'
               and m.legacy_id = pp.company_group_id::text)
      from source s
    returning id
  )
  insert into legacy_migration_map (legacy_table, legacy_id, new_id)
  select 'prospect_signals', s.id::text, s.new_id from source s
    where s.new_id in (select id from insere)
      on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rapport := v_rapport || jsonb_build_object('signals', v_n);

  return v_rapport;
end $$;

comment on function app.migrate_legacy_workspace(uuid, uuid) is
  'Reprend les données d''un workspace du socle v1 vers une organisation du nouveau '
  'schéma. Idempotente : rejouable sans rien dupliquer. N''écrase aucune donnée '
  'existante. L''historique de prospect_actions n''est PAS repris — voir le fichier '
  'de migration pour le motif.';

-- ============================================================================
-- Ce qui n'est volontairement pas repris
--
-- `prospect_actions` : le socle v1 enregistre des actions isolées, sans notion
-- d'inscription à une séquence. La table cible exige une inscription et une clé
-- d'idempotence, toutes deux inexistantes en amont. Les reprendre supposerait de
-- fabriquer des inscriptions qui n'ont jamais existé, et donc d'injecter dans la
-- machine à états du séquenceur des objets au passé faux. C'est de l'historique,
-- pas de l'état courant, et il reste consultable dans les tables d'origine, qui
-- ne sont pas supprimées.
--
-- `prospect_imports` : vide sur la base de référence, et la table cible attend
-- un mapping de colonnes que le socle v1 ne conserve pas.
--
-- Les credentials se reprennent par une procédure distincte : ils sont chiffrés
-- avec deux mécanismes différents (AES-256-GCM d'un côté, pgcrypto de l'autre),
-- donc illisibles d'un schéma à l'autre sans déchiffrement intermédiaire.
-- ============================================================================

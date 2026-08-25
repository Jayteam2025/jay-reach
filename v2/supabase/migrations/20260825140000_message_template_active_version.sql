-- ============================================================================
-- Version active d'un template de message (T19, partie éditeur).
--
-- Le versionnage existait (`parent_id` + `version` + unicité `(parent_id,
-- version, locale)`) mais rien ne désignait la version « en vigueur ». Le tick
-- prenait la DERNIÈRE version — impossible de revenir en arrière (réactiver la v3
-- alors que la v4 existe, spec §11). On ajoute `is_active` : au plus une version
-- active par lignée (parent_id ou id de la racine) ET par langue.
--
-- Rétro-compatible : par défaut `is_active = true`. Sur une base qui aurait déjà
-- PLUSIEURS versions pour une même (lignée, langue), on ne garde active que la
-- plus récente (dédup ci-dessous) avant de poser l'index d'unicité — sinon sa
-- création échouerait. La résolution « dernière version active » redonne alors le
-- même résultat qu'avant. L'éditeur, lui, désactive les autres versions à chaque
-- nouvelle version : une seule active, celle en vigueur.
-- ============================================================================
alter table public.message_templates
  add column if not exists is_active boolean not null default true;

-- Dédup : ne laisser active que la version la plus récente par (lignée, langue),
-- pour rendre l'index d'unicité ci-dessous applicable sur une base existante.
with ranked as (
  select id,
         row_number() over (
           partition by coalesce(parent_id, id), locale order by version desc
         ) as rn
    from public.message_templates
)
update public.message_templates m
   set is_active = false
  from ranked
 where ranked.id = m.id and ranked.rn > 1 and m.is_active;

-- Au plus une version active par (lignée, langue). La lignée = `parent_id` s'il
-- existe, sinon l'`id` de la racine (une racine sans parent est sa propre lignée).
create unique index if not exists uq_message_templates_active_per_family_locale
  on public.message_templates (coalesce(parent_id, id), locale)
  where is_active;

comment on column public.message_templates.is_active is
  'Version en vigueur pour cette lignée (parent_id ou id) et cette langue. Au plus une active par (lignée, langue) ; le retour arrière réactive une version antérieure.';

-- ----------------------------------------------------------------------------
-- RPC : enregistrer une version (atomique). Modifier = NOUVELLE version, jamais
-- en place (spec §7) → le taux de réponse se mesure par version, et on peut
-- revenir en arrière. Crée une nouvelle lignée si `p_family` est null, sinon
-- ajoute une version à la lignée pour cette langue et désactive l'ancienne.
-- SECURITY DEFINER : contrôle admin explicite (la RLS ne s'applique pas dedans).
-- ----------------------------------------------------------------------------
create or replace function app.save_message_template_version(
  p_org uuid,
  p_family uuid,
  p_name text,
  p_channel channel_kind,
  p_locale text,
  p_subject text,
  p_body text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_version int;
  v_id uuid;
begin
  if not (p_org in (select app.user_orgs('admin'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_family is null then
    -- Nouvelle lignée : racine (parent_id null), version 1, active.
    insert into public.message_templates
      (organization_id, name, channel, locale, version, subject, body, is_active, created_by)
    values (p_org, p_name, p_channel, p_locale, 1, p_subject, p_body, true, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  -- Lignée existante : prochaine version pour cette (lignée, langue).
  select coalesce(max(version), 0) + 1 into v_version
    from public.message_templates
   where coalesce(parent_id, id) = p_family and locale = p_locale and organization_id = p_org;

  -- Désactive l'active courante avant d'insérer la nouvelle (index d'unicité).
  update public.message_templates
     set is_active = false
   where coalesce(parent_id, id) = p_family and locale = p_locale
     and organization_id = p_org and is_active;

  insert into public.message_templates
    (organization_id, parent_id, name, channel, locale, version, subject, body, is_active, created_by)
  values (p_org, p_family, p_name, p_channel, p_locale, v_version, p_subject, p_body, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- RPC : retour arrière — réactiver une version antérieure (désactive l'autre
-- active de la même lignée+langue). Le `sent_count` de la version réactivée
-- gouverne le rodage (spec §11) : il n'est pas remis à zéro ici.
create or replace function app.activate_message_template_version(p_id uuid)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_family uuid;
  v_locale text;
  v_org uuid;
begin
  select coalesce(parent_id, id), locale, organization_id
    into v_family, v_locale, v_org
    from public.message_templates where id = p_id;
  if v_org is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (v_org in (select app.user_orgs('admin'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.message_templates set is_active = false
   where coalesce(parent_id, id) = v_family and locale = v_locale
     and organization_id = v_org and is_active and id <> p_id;
  update public.message_templates set is_active = true where id = p_id;
end;
$$;

grant execute on function app.save_message_template_version(uuid, uuid, text, channel_kind, text, text, text) to authenticated;
grant execute on function app.activate_message_template_version(uuid) to authenticated;

-- Wrappers `public` (PostgREST n'expose que `public`), appelés par les server actions.
create or replace function public.save_message_template_version(
  p_org uuid, p_family uuid, p_name text, p_channel channel_kind,
  p_locale text, p_subject text, p_body text
) returns uuid language sql security definer set search_path = public, app as $$
  select app.save_message_template_version(p_org, p_family, p_name, p_channel, p_locale, p_subject, p_body);
$$;
grant execute on function public.save_message_template_version(uuid, uuid, text, channel_kind, text, text, text) to authenticated;

create or replace function public.activate_message_template_version(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  perform app.activate_message_template_version(p_id);
end;
$$;
grant execute on function public.activate_message_template_version(uuid) to authenticated;

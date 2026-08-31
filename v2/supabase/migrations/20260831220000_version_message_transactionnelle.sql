-- Le versionnage des messages connaît l'origine (bibliothèque ou étape).
--
-- `save_message_template_version` existait déjà et faisait le bon travail :
-- calcul de la version suivante, désactivation de l'active, insertion, le tout
-- dans une transaction — un index n'autorise qu'une version active par
-- (famille, langue), et le faire en deux écritures depuis l'application
-- laisserait la famille sans version active entre les deux.
--
-- Elle ne connaissait pas `origin`. Plutôt qu'une seconde fonction de
-- versionnage qui aurait fini par diverger, on lui ajoute un paramètre, avec
-- « library » par défaut : les appels existants ne changent pas.
--
-- Une nouvelle version hérite de l'origine de sa famille. Sans ça, réécrire un
-- message d'étape le ferait apparaître dans la bibliothèque à la version
-- suivante, sans que personne ne l'y ait versé.
create or replace function app.save_message_template_version(
  p_org uuid, p_family uuid, p_name text, p_channel channel_kind,
  p_locale text, p_subject text, p_body text, p_origin text default 'library'
) returns uuid
language plpgsql security definer set search_path to 'public', 'app'
as $function$
declare
  v_version int;
  v_id uuid;
  v_origin text;
begin
  if not (p_org in (select app.user_orgs('admin'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_origin not in ('library', 'step') then
    raise exception 'origine invalide : %', p_origin;
  end if;

  if p_family is null then
    insert into public.message_templates
      (organization_id, name, channel, locale, version, subject, body, is_active, origin, created_by)
    values (p_org, p_name, p_channel, p_locale, 1, p_subject, p_body, true, p_origin, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.message_templates
   where coalesce(parent_id, id) = p_family and locale = p_locale and organization_id = p_org;

  select origin into v_origin
    from public.message_templates
   where coalesce(parent_id, id) = p_family and organization_id = p_org
   order by version desc limit 1;

  update public.message_templates
     set is_active = false
   where coalesce(parent_id, id) = p_family and locale = p_locale
     and organization_id = p_org and is_active;

  insert into public.message_templates
    (organization_id, parent_id, name, channel, locale, version, subject, body, is_active, origin, created_by)
  values (p_org, p_family, p_name, p_channel, p_locale, v_version, p_subject, p_body, true,
          coalesce(v_origin, p_origin), auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.save_message_template_version(
  p_org uuid, p_family uuid, p_name text, p_channel channel_kind,
  p_locale text, p_subject text, p_body text, p_origin text default 'library'
) returns uuid
language sql security definer set search_path to 'public', 'app'
as $function$
  select app.save_message_template_version(p_org, p_family, p_name, p_channel, p_locale, p_subject, p_body, p_origin);
$function$;

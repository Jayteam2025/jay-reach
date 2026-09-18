-- F15 : rattrape les comptes LinkedIn déjà connectés avant que
-- `synchroniserExpediteurLinkedIn` (packages/core/src/fonctions/expediteurs.ts)
-- n'existe. Le correctif applicatif ne répare que l'avenir : il ne s'exécute
-- qu'au prochain enregistrement depuis Réglages > Expéditeurs, et rien
-- n'oblige quiconque à rouvrir cet écran. Cette migration pose directement
-- l'expéditeur (`senders`, kind='linkedin') que cette fonction aurait créé ou
-- mis à jour si quelqu'un avait réenregistré aujourd'hui.
--
-- Un compte = le jeton le plus récent (`last_used_at desc nulls last`) de
-- chaque (organisation, user_id) — même sélection que `listerComptesLinkedIn`
-- et `modifierCompteLinkedIn`. Seuls les comptes dont CE jeton est actif
-- reçoivent un expéditeur ; un jeton désactivé ne doit rien réactiver.
-- Plafond et fenêtre d'envoi repris de `linkedin_settings` de l'organisation
-- (repli sur les valeurs par défaut de l'écran si l'organisation n'a jamais
-- enregistré de réglage LinkedIn), jamais de valeur inventée ici.
--
-- Rejouable : un second passage retrouve la ligne déjà créée par son
-- `provider_ref` et se contente de la remettre à jour, sans doublon. Ne fait
-- rien s'il n'existe aucun jeton d'extension actif (aucune ligne
-- `extension_tokens`, ou toutes désactivées).

do $$
declare
  r record;
  v_daily_cap int;
  v_business_hours jsonb;
  v_timezone text;
  v_existing_id uuid;
begin
  for r in
    select distinct on (et.organization_id, et.user_id)
      et.organization_id, et.user_id, et.linkedin_profile_name, et.is_active
    from extension_tokens et
    order by et.organization_id, et.user_id, et.last_used_at desc nulls last
  loop
    if not r.is_active then
      continue;
    end if;

    select coalesce(ls.daily_cap, 25),
           jsonb_build_object(
             'startHour', coalesce(ls.send_from_hour, 9),
             'endHour', coalesce(ls.send_to_hour, 18),
             'days', coalesce(to_jsonb(ls.send_days), '[1,2,3,4,5]'::jsonb)
           ),
           coalesce(ls.timezone, 'Europe/Paris')
      into v_daily_cap, v_business_hours, v_timezone
      from (values (1)) as d(x)
      left join linkedin_settings ls on ls.organization_id = r.organization_id;

    select id into v_existing_id
      from senders
     where organization_id = r.organization_id and kind = 'linkedin' and provider_ref = r.user_id::text
     limit 1;

    if v_existing_id is not null then
      update senders
         set is_active = true,
             daily_quota = v_daily_cap,
             business_hours = v_business_hours,
             timezone = v_timezone,
             display_name = coalesce(r.linkedin_profile_name, display_name)
       where id = v_existing_id;
    else
      insert into senders (organization_id, kind, identity, display_name, daily_quota, business_hours, timezone,
                            is_active, provider_id, provider_ref)
      values (r.organization_id, 'linkedin', 'linkedin:' || r.user_id::text, r.linkedin_profile_name,
              v_daily_cap, v_business_hours, v_timezone, true, 'extension', r.user_id::text);
    end if;
  end loop;
end $$;

-- F15 : rattrape les comptes LinkedIn déjà connectés avant que
-- `synchroniserExpediteurLinkedIn` (packages/core/src/fonctions/expediteurs.ts)
-- n'existe. Le correctif applicatif ne répare que l'avenir : il ne s'exécute
-- qu'au prochain enregistrement depuis Réglages > Expéditeurs, et rien
-- n'oblige quiconque à rouvrir cet écran. Cette migration pose directement
-- l'expéditeur (`senders`, kind='linkedin') que cette fonction aurait créé ou
-- mis à jour si quelqu'un avait réenregistré aujourd'hui.
--
-- Doit s'appliquer APRÈS `20260918140300_senders_provider_ref_unique.sql` :
-- l'upsert ci-dessous s'appuie sur l'index unique qu'elle pose.
--
-- Un compte = le jeton le plus récent (`last_used_at desc nulls last`) de
-- chaque (organisation, user_id) — même sélection que `listerComptesLinkedIn`
-- et `modifierCompteLinkedIn`. Seuls les comptes « connectés » au sens de
-- l'écran (`listerComptesLinkedIn` : jeton actif ET déjà utilisé une fois,
-- `is_active && last_used_at !== null`) reçoivent un expéditeur — un jeton
-- tout juste créé mais jamais utilisé n'en reçoit pas, même actif : l'écran
-- l'afficherait « Non connecté », lui poser un expéditeur actif serait
-- justement l'écart entre la base et l'écran que cette tâche existe pour
-- supprimer. Plafond et fenêtre d'envoi repris de `linkedin_settings` de
-- l'organisation (repli sur les valeurs par défaut de l'écran si
-- l'organisation n'a jamais enregistré de réglage LinkedIn), jamais de valeur
-- inventée ici.
--
-- Rejouable : upsert par (organization_id, kind, provider_ref), un second
-- passage remet la ligne déjà créée à jour sans doublon. Ne fait rien s'il
-- n'existe aucun jeton d'extension connecté (aucune ligne `extension_tokens`,
-- toutes désactivées, ou toutes jamais utilisées).

do $$
declare
  r record;
  v_daily_cap int;
  v_business_hours jsonb;
  v_timezone text;
begin
  for r in
    select distinct on (et.organization_id, et.user_id)
      et.organization_id, et.user_id, et.linkedin_profile_name, et.is_active, et.last_used_at
    from extension_tokens et
    order by et.organization_id, et.user_id, et.last_used_at desc nulls last
  loop
    if not r.is_active or r.last_used_at is null then
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

    insert into senders (organization_id, kind, identity, display_name, daily_quota, business_hours, timezone,
                          is_active, provider_id, provider_ref)
    values (r.organization_id, 'linkedin', 'linkedin:' || r.user_id::text, r.linkedin_profile_name,
            v_daily_cap, v_business_hours, v_timezone, true, 'extension', r.user_id::text)
    on conflict (organization_id, kind, provider_ref) do update
       set is_active = excluded.is_active,
           daily_quota = excluded.daily_quota,
           business_hours = excluded.business_hours,
           timezone = excluded.timezone,
           display_name = coalesce(excluded.display_name, senders.display_name);
  end loop;
end $$;

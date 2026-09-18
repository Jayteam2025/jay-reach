-- EN ATTENTE (G6, 18/09) : NE PAS APPLIQUER telle quelle. Vérifié sur la base OSS
-- (jstcgfgwaeesrqztsvhe, organisation « Jay Reach », eee8d760-63ed-4f14-8867-5d38c5602dc4) :
-- deux `extension_tokens` distincts y sont actifs ET déjà utilisés (`last_used_at` non nul) —
-- celui d'Alexandre De Clercq (hey@jay-assistant.fr, le compte de production) ET celui de
-- JB (renartjeanbaptiste@gmail.com, un compte de test). La boucle `distinct on
-- (organization_id, user_id)` ci-dessous traiterait les DEUX : les deux lignes `senders`
-- LinkedIn déjà en base ont `provider_ref` NULL (`senders_org_kind_provider_ref_key` ne les
-- matche jamais, NULL n'égale jamais NULL dans un index unique), donc l'upsert créerait DEUX
-- lignes actives neuves plutôt que d'en réutiliser une — `linkedin_settings.daily_cap` valant
-- 25 pour cette organisation, la campagne se retrouverait avec 2 x 25 = 50 envois/jour au lieu
-- de 25, et le compte de test de JB serait activé comme expéditeur de production au passage.
-- À décider avant d'appliquer : soit filtrer cette migration sur le seul compte de production
-- (lequel ?), soit désactiver/retirer le jeton de test avant de la rejouer, soit ne rattraper
-- qu'un seul compte par organisation par construction (le plus récemment utilisé, pas tous).
--
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

-- Lot 4b : le volume d'envoi LinkedIn se règle dans `organization_settings`, par type d'action.
--
-- Jusqu'ici un seul curseur hebdomadaire (`linkedin_settings.weekly_cap`) couvrait invitations et
-- messages, alors que seule l'invitation met un compte en danger. Le rythme lit désormais deux
-- clés : `linkedin_invitations_par_semaine` et `linkedin_messages_par_semaine`, comme tous les
-- autres plafonds du produit. `weekly_cap` et `daily_cap` ne sont plus lus par le rythme.
--
-- Cette migration REPORTE le réglage existant pour qu'aucune organisation ne le perde : une
-- organisation qui avait posé `weekly_cap` retrouve sa valeur dans
-- `linkedin_invitations_par_semaine` (le curseur d'alors portait surtout sur les invitations ; les
-- messages gardent leur défaut, plus large). Additive et idempotente : une clé déjà posée n'est
-- JAMAIS écrasée, une seconde exécution ne change rien. Les colonnes de `linkedin_settings` ne sont
-- ni modifiées ni supprimées.
--
-- La migration se vérifie elle-même : elle échoue si le report n'a pas eu l'effet attendu.

do $$
declare
  v_attendus int;
  v_poses int;
  v_divergents int;
  v_manquants int;
begin
  -- Les organisations dont le réglage n'a pas encore été reporté.
  select count(*) into v_attendus
    from linkedin_settings ls
   where not exists (
     select 1 from organization_settings os
      where os.organization_id = ls.organization_id and os.key = 'linkedin_invitations_par_semaine'
   );

  with posees as (
    insert into organization_settings (organization_id, key, value)
    select ls.organization_id, 'linkedin_invitations_par_semaine', to_jsonb(ls.weekly_cap)
      from linkedin_settings ls
     where not exists (
       select 1 from organization_settings os
        where os.organization_id = ls.organization_id and os.key = 'linkedin_invitations_par_semaine'
     )
    on conflict (organization_id, key) do nothing
    returning organization_id, value
  )
  select count(*),
         count(*) filter (where p.value is distinct from (
           select to_jsonb(ls.weekly_cap) from linkedin_settings ls where ls.organization_id = p.organization_id
         ))
    into v_poses, v_divergents
    from posees p;

  if v_poses <> v_attendus then
    raise exception 'report des plafonds LinkedIn : % organisation(s) à reporter, % report(s) posé(s)', v_attendus, v_poses;
  end if;
  if v_divergents > 0 then
    raise exception 'report des plafonds LinkedIn : % valeur(s) reportée(s) différente(s) de weekly_cap', v_divergents;
  end if;

  -- Contrôle final : plus aucune organisation avec un réglage historique n'est sans valeur reportée.
  select count(*) into v_manquants
    from linkedin_settings ls
   where not exists (
     select 1 from organization_settings os
      where os.organization_id = ls.organization_id and os.key = 'linkedin_invitations_par_semaine'
   );
  if v_manquants > 0 then
    raise exception 'report des plafonds LinkedIn : % organisation(s) sans linkedin_invitations_par_semaine après report', v_manquants;
  end if;
end $$;

-- Répare les inscriptions restées en arrière d'une étape après un rejeu (issue #160).
--
-- Contexte mesuré le 14/10 sur la campagne « Jay coach - RH ». La panne SalesBlink du 13 a mis
-- sept inscriptions en pause ; `mettreInscriptionEnPause` a ramené `current_step` sur l'étape en
-- échec, pour qu'elle soit rejouée. Reprises à l'écran le 14 à 11h01, leurs emails sont bien
-- partis — mais rien n'a avancé `current_step` : au départ réel, l'ancien code ne posait que
-- `next_action_at`. Résultat : le tick les voyait dues, retombait sur une étape dont la clé
-- d'idempotence était déjà prise, et les ignorait. Une ligne de journal par inscription et par
-- minute, et ces contacts n'auraient jamais reçu l'étape suivante.
--
-- Le correctif de code (`cloreDepartReel`) ferme la porte pour l'avenir : il compare le rang de
-- l'étape qui part à `current_step` et avance l'inscription quand les deux coïncident. Il ne
-- rattrape pas celles qui sont DÉJÀ dans cet état : leur action est partie, le départ réel a eu
-- lieu, plus personne ne repassera dessus.
--
-- Cette migration ne recalcule rien elle-même. Elle efface seulement l'échéance de ces
-- inscriptions, ce qui les rend visibles à `rattraperEcheancesManquantes` (qui exige
-- `next_action_at is null`). Le worker corrigé les reprend alors par le chemin déjà testé —
-- celui qui avance l'étape ET pose l'échéance avec le vrai calcul, jitter compris. Reproduire ce
-- calcul en SQL donnerait une échéance sans jitter, donc des envois en rafale à la même seconde.
--
-- ORDRE D'APPLICATION : le worker doit porter le correctif AVANT cette migration. Appliquée
-- contre l'ancien worker, les inscriptions seraient reprises par l'ancien rattrapage, qui pose
-- l'échéance depuis le départ de l'étape PRÉCÉDENTE et les remettrait exactement dans l'état
-- qu'on veut quitter.
--
-- Critère volontairement étroit : `status = 'active'`, une action de l'étape COURANTE réellement
-- partie, et une échéance posée. Une inscription dont l'action courante n'est pas partie n'est
-- pas concernée (elle attend son envoi, c'est l'état normal), ni une inscription terminée.

do $$
declare
  reparees int;
begin
  with bloquees as (
    select e.id
      from enrollments e
      join lateral (
        select id
          from sequence_steps
         where campaign_id = e.campaign_id
         order by position asc
         offset e.current_step
         limit 1
      ) s on true
      join actions a
        on a.step_id = s.id
       and a.enrollment_id = e.id
       and a.dispatched_at is not null
     where e.status = 'active'
       and e.next_action_at is not null
  )
  update enrollments
     set next_action_at = null
   where id in (select id from bloquees);

  get diagnostics reparees = row_count;
  raise notice 'inscriptions rendues au rattrapage : %', reparees;

  -- La migration se vérifie elle-même : plus aucune inscription active ne doit porter à la fois
  -- une action courante partie et une échéance. Si le compte n'est pas nul, l'UPDATE n'a pas
  -- couvert ce qu'il visait et il vaut mieux le savoir ici qu'en lisant les journaux du worker.
  if exists (
    select 1
      from enrollments e
      join lateral (
        select id from sequence_steps
         where campaign_id = e.campaign_id
         order by position asc offset e.current_step limit 1
      ) s on true
      join actions a on a.step_id = s.id and a.enrollment_id = e.id and a.dispatched_at is not null
     where e.status = 'active' and e.next_action_at is not null
  ) then
    raise exception 'des inscriptions actives gardent une etape courante deja partie ET une echeance';
  end if;
end $$;

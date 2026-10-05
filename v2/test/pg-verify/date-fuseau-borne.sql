-- ============================================================================
-- Borne de journée dans le fuseau de l'organisation (F12, revue du 18/09).
--
-- Motif fautif, RENCONTRÉ RÉELLEMENT dans lireContraintesSendersDuJour,
-- lireEnvoisDuJour, la file du jour d'aujourdhui.ts et le comptage des
-- « partis » : `$jour::date at time zone $fuseau`. Avec un `date` à gauche,
-- Postgres résout la surcharge `timestamptz AT TIME ZONE` (pas celle de
-- `timestamp`) : il caste d'abord `$jour::date` en `timestamptz` via le
-- fuseau de LA SESSION, convertit cet instant en horaire local `$fuseau`
-- (un `timestamp` SANS fuseau), puis ce résultat est réinterprété comme du
-- fuseau de LA SESSION au moment de la comparaison avec une colonne
-- `timestamptz` — la fenêtre du jour se retrouve décalée de deux fois le
-- décalage horaire de `$fuseau` (quatre heures pour Europe/Paris en été).
--
-- Correctif : `$jour::date::timestamp at time zone $fuseau` — le cast
-- intermédiaire vers `timestamp` force la bonne surcharge (celle qui traite
-- directement `$jour` comme un jour local à `$fuseau`).
--
-- Ce test insère deux actions RÉELLES (table `actions`, migrées) et compare
-- le compte rendu par les deux bornes — pas une preuve textuelle, une preuve
-- d'exécution contre un vrai Postgres (`test/pg-verify/run.sh`).
--
-- PORTÉE (revue du 18/09) : ce test prouve le MÉCANISME du piège Postgres —
-- une requête ad hoc réécrite ci-dessous avec les deux bornes, pas les cinq
-- requêtes réelles du code (`lireContraintesSendersDuJour`, `lireEnvoisDuJour`,
-- la file du jour et le comptage des « partis » d'`aujourdhui.ts`, `campagnes.ts`).
-- Il ne rejoue pas leur SQL mot pour mot ni ne passe par le code TypeScript :
-- c'est une preuve que le motif corrigé se comporte comme attendu contre un
-- vrai Postgres, pas une preuve d'intégration des cinq call sites eux-mêmes.
-- ============================================================================
\set ON_ERROR_STOP on

set timezone = 'UTC';

reset role;
insert into auth.users(id, email)
  values ('dddddddd-0000-4000-8000-000000000001', 'fuseau@test.local')
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', 'dddddddd-0000-4000-8000-000000000001', false);
select app.create_organization('Org Fuseau', 'org-fuseau') as orgf \gset
reset role;
select set_config('test.orgf', :'orgf', false);

insert into public.sources (id, organization_id, provider_id, name)
  values ('dddddddd-0000-4000-8000-000000000011', :'orgf', 'adzuna', 'Source fuseau');
insert into public.campaigns (id, organization_id, name, source_id)
  values ('dddddddd-0000-4000-8000-000000000021', :'orgf', 'Campagne fuseau', 'dddddddd-0000-4000-8000-000000000011');
insert into public.contacts (id, organization_id, first_name, last_name)
  values ('dddddddd-0000-4000-8000-000000000031', :'orgf', 'Test', 'Fuseau');
insert into public.enrollments (id, organization_id, campaign_id, contact_id)
  values ('dddddddd-0000-4000-8000-000000000041', :'orgf', 'dddddddd-0000-4000-8000-000000000021', 'dddddddd-0000-4000-8000-000000000031');

-- 2026-09-18 est un vendredi : Europe/Paris est alors en heure d'été (UTC+2).
-- Minuit Paris le 18/09 = 2026-09-17 22:00:00 UTC ; minuit Paris le 19/09 =
-- 2026-09-18 22:00:00 UTC. La bonne fenêtre du « 18/09 à Paris » est donc
-- [2026-09-17 22:00:00+00, 2026-09-18 22:00:00+00).
--
-- Action A : remise à 2026-09-18 00:30:00 UTC (02:30 Paris) — DANS la bonne
-- fenêtre (juste après son début réel), mais le motif fautif ne commence sa
-- fenêtre qu'à 02:00 UTC (comme mesuré : minuit Paris rendu comme 02:00
-- UTC) : cette action tombe encore avant, le motif fautif la RATE.
insert into public.actions (id, organization_id, enrollment_id, channel, status, dispatched_at, idempotency_key)
  values ('dddddddd-0000-4000-8000-000000000051', :'orgf', 'dddddddd-0000-4000-8000-000000000041', 'email', 'dispatched', '2026-09-18 00:30:00+00', 'fuseau-borne-a1');
-- Action B : remise à 2026-09-18 10:00:00 UTC (midi Paris) — dans la bonne
-- fenêtre ET dans la fenêtre fautive (témoin : les deux motifs doivent la
-- compter, sinon le test ne prouverait rien).
insert into public.actions (id, organization_id, enrollment_id, channel, status, dispatched_at, idempotency_key)
  values ('dddddddd-0000-4000-8000-000000000052', :'orgf', 'dddddddd-0000-4000-8000-000000000041', 'email', 'dispatched', '2026-09-18 10:00:00+00', 'fuseau-borne-a2');

do $$
declare
  v_org uuid := current_setting('test.orgf')::uuid;
  v_fautif int;
  v_correct int;
begin
  -- Motif fautif : `$1::date at time zone $2`, tel qu'il était dans le code avant
  -- correctif (aujourdhui.ts, campagnes.ts).
  select count(*) into v_fautif
    from public.actions
   where organization_id = v_org
     and dispatched_at >= ('2026-09-18'::date at time zone 'Europe/Paris')
     and dispatched_at < (('2026-09-18'::date + 1) at time zone 'Europe/Paris');

  -- Motif correctif : `$1::date::timestamp at time zone $2`.
  select count(*) into v_correct
    from public.actions
   where organization_id = v_org
     and dispatched_at >= ('2026-09-18'::date::timestamp at time zone 'Europe/Paris')
     and dispatched_at < (('2026-09-18'::date + 1)::timestamp at time zone 'Europe/Paris');

  if v_fautif <> 1 then
    raise exception 'FAIL fuseau-repro : le motif fautif comptait % action(s), 1 attendue (le bogue mesuré ne s''est pas reproduit — vérifier le fuseau de session ou les horodatages insérés)', v_fautif;
  end if;
  raise notice 'OK fuseau-repro (motif fautif : 1/2 actions, celle des deux premières heures Paris est ratée, comme mesuré en base réelle)';

  if v_correct <> 2 then
    raise exception 'FAIL fuseau-correctif : le motif corrigé compte % action(s), 2 attendues (les deux actions du 18/09 à Paris)', v_correct;
  end if;
  raise notice 'OK fuseau-correctif (motif $jour::date::timestamp at time zone $fuseau : 2/2 actions)';
end $$;

select '=== DATE FUSEAU BORNE OK ===' as result;

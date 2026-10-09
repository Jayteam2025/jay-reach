-- ============================================================================
-- `signals_personne_uidx` couvrait deux kinds ; `job_change` en est un
-- troisième. Un `on conflict ... where <prédicat>` n'infère un index partiel que
-- si le prédicat CORRESPOND : sans cet élargissement, l'enregistrement d'un
-- changement de poste échoue sur « there is no unique or exclusion constraint
-- matching the ON CONFLICT specification », au premier passage réel.
--
-- C'est le même piège que la migration 20261009180000, trois heures plus tôt.
-- D'où le contrôle de harnais qui compare désormais le prédicat de CET index à
-- `KINDS_PERSONNE` : la prochaine source de personnes rougira ici au lieu de
-- tomber chez l'opérateur.
--
-- Le nouvel index est créé avant que l'ancien ne tombe.
-- ============================================================================

create unique index if not exists signals_personne_kinds_uidx
  on public.signals (organization_id, external_id)
  where kind in ('post_engagement', 'people_search', 'job_change');

drop index if exists public.signals_personne_uidx;

do $$
declare v_pred text;
begin
  select indexdef into v_pred from pg_indexes
   where tablename = 'signals' and indexname = 'signals_personne_kinds_uidx';
  if v_pred is null then
    raise exception 'signals_personne_kinds_uidx absent';
  end if;
  if v_pred not like '%job_change%' then
    raise exception 'signals_personne_kinds_uidx ne couvre pas job_change';
  end if;
end $$;

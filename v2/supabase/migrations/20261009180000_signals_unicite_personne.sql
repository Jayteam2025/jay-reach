-- ============================================================================
-- L'unicité d'un signal de PERSONNE portait sur un index partiel réservé à un
-- seul kind :
--
--   signals_post_engagement_uidx ... where kind = 'post_engagement'
--
-- `enregistrerEngageur` s'appuie dessus par un `on conflict (organization_id,
-- external_id) where kind = 'post_engagement'`. Avec un second kind de personne
-- (`people_search`), cet `on conflict` n'infère plus aucun index et Postgres
-- refuse l'insertion : « there is no unique or exclusion constraint matching
-- the ON CONFLICT specification ». Le collecteur tomberait au PREMIER
-- enregistrement réel, et nulle part avant.
--
-- L'index couvre donc la FAMILLE. Le prédicat est écrit à l'identique de celui
-- que portera l'`on conflict` : c'est ce qui permet l'inférence.
--
-- Le nouvel index est créé AVANT la suppression de l'ancien : à aucun instant
-- les engageurs ne restent sans contrainte d'unicité.
-- ============================================================================

create unique index if not exists signals_personne_uidx
  on public.signals (organization_id, external_id)
  where kind in ('post_engagement', 'people_search');

drop index if exists public.signals_post_engagement_uidx;

-- Se vérifie elle-même : un index absent ne se verrait qu'au premier doublon
-- réellement inséré, c'est-à-dire trop tard.
do $$
begin
  if not exists (select 1 from pg_indexes where tablename = 'signals' and indexname = 'signals_personne_uidx') then
    raise exception 'signals_personne_uidx absent';
  end if;
  if exists (select 1 from pg_indexes where tablename = 'signals' and indexname = 'signals_post_engagement_uidx') then
    raise exception 'signals_post_engagement_uidx aurait du etre remplace';
  end if;
end $$;

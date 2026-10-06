-- Lot 4a, tâche 11 (tour 1) : la mémoire d'écart ne garde plus l'URN lisible.
--
-- `linkedin_engageurs_ecartes` est un cache d'économie (ne pas rescorer, donc ne pas
-- repayer, une personne déjà jugée) : un seul lecteur, par égalité exacte, jamais
-- affichée. Elle stocke désormais le sha256 hexadécimal de l'ancien `external_id`
-- (`<url du post>:<urn>`), et la purge de rétention l'efface au bout de la même durée
-- que les personnes. Les lignes existantes sont converties en place, sans perte.

update linkedin_engageurs_ecartes
   set external_id = encode(sha256(convert_to(external_id, 'UTF8')), 'hex')
 where external_id !~ '^[0-9a-f]{64}$';

comment on column linkedin_engageurs_ecartes.external_id is
  'sha256 hexadécimal de `<url du post>:<urn>` : une empreinte, jamais l''identifiant lisible.';

create index if not exists linkedin_engageurs_ecartes_scored_at_idx
  on linkedin_engageurs_ecartes (scored_at);

-- Contrôle : l'index existe et plus aucune ligne n'est lisible.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'linkedin_engageurs_ecartes_scored_at_idx') then
    raise exception 'index manquant : linkedin_engageurs_ecartes_scored_at_idx';
  end if;
  if exists (select 1 from linkedin_engageurs_ecartes where external_id !~ '^[0-9a-f]{64}$') then
    raise exception 'linkedin_engageurs_ecartes porte encore un identifiant lisible';
  end if;
end $$;

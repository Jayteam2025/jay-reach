-- Rattrapage des fiches de post : la lecture d'une page de post est une requête LinkedIn comme une
-- autre, et doit compter dans le même budget que la collecte.
--
-- `linkedin_requetes` admettait deux origines (un passage de collecte, une action d'envoi) et une
-- contrainte exigeait exactement l'une des deux. Une lecture de fiche n'a ni l'une ni l'autre : elle
-- se rattache à la FICHE qu'elle lit (`post_id`), et la contrainte passe à « exactement une origine
-- sur trois ». Les lignes existantes (une origine chacune) restent valides.
--
-- Cascade, comme les deux autres origines : la trace n'a de valeur que sur la fenêtre du plafond.
-- La purge d'une fiche emporte donc ses traces ; le plafond du jour n'en souffre pas, une fiche
-- purgée ayant dépassé sa fenêtre de décision depuis des semaines.

alter table public.linkedin_requetes
  add column if not exists post_id uuid references public.linkedin_posts(id) on delete cascade;

alter table public.linkedin_requetes drop constraint if exists linkedin_requetes_une_origine;
alter table public.linkedin_requetes
  add constraint linkedin_requetes_une_origine
  check (num_nonnulls(source_run_id, action_queue_id, post_id) = 1);

-- Le comptage du plafond du jour ne lit que les lignes typées 'fiche' : index partiel, minuscule.
create index if not exists linkedin_requetes_fiche_idx
  on public.linkedin_requetes (organization_id, requested_at)
  where kind = 'fiche';

do $$
begin
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_requetes'::regclass and attname = 'post_id' and not attisdropped
  ) then
    raise exception 'colonne linkedin_requetes.post_id absente';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.linkedin_requetes'::regclass and conname = 'linkedin_requetes_une_origine'
       and pg_get_constraintdef(oid) like '%num_nonnulls%post_id%'
  ) then
    raise exception 'contrainte linkedin_requetes_une_origine absente ou de forme inattendue';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'linkedin_requetes' and indexname = 'linkedin_requetes_fiche_idx'
       and indexdef like '%kind = ''fiche''%'
  ) then
    raise exception 'index linkedin_requetes_fiche_idx manquant ou de forme inattendue';
  end if;
end $$;

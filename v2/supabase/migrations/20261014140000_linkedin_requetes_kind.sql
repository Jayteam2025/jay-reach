-- Plafond de visites de profil LinkedIn (issue #165).
--
-- `linkedin_requetes` trace chaque requête partie vers LinkedIn, sans dire LAQUELLE. Or c'est la
-- vue de profil que LinkedIn limite le plus durement (80 à 100 par jour sans Premium) : sans type,
-- une lecture de réactions et une vue de profil se comptent pareil, et aucun plafond ne peut
-- borner l'une sans l'autre.
--
-- Additive, aucune ligne existante n'est touchée. `kind` n'a PAS de défaut : une requête déjà
-- tracée n'est pas requalifiable après coup (la table n'a gardé ni l'adresse ni le type de source
-- qui permettrait de le deviner), et lui prêter un type serait prétendre le contraire. Elles
-- restent à `null`, et ne comptent donc pas dans le plafond de visites : il part de zéro au
-- déploiement, ce qui est le seul comportement honnête.
--
-- Pas de `check` sur les valeurs : la liste s'allongera (recherche, envoi) et chaque ajout
-- coûterait une migration pour rien ; la seule valeur lue aujourd'hui est 'profil'.

alter table public.linkedin_requetes add column if not exists kind text;

-- Le comptage est « les visites de l'organisation sur sept jours glissants ». Partiel : seules les
-- lignes typées 'profil' y entrent, l'index reste minuscule face à la table des requêtes de
-- collecte et d'envoi, qui grossit à chaque passage.
create index if not exists linkedin_requetes_profil_idx
  on public.linkedin_requetes (organization_id, requested_at)
  where kind = 'profil';

-- La migration se vérifie elle-même : une colonne ou un index absents ne se verraient qu'au
-- premier passage réel, où le comptage lèverait en pleine collecte.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'linkedin_requetes'
       and column_name = 'kind' and data_type = 'text' and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'colonne linkedin_requetes.kind absente, ou non nullable, ou avec un defaut';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'linkedin_requetes' and indexname = 'linkedin_requetes_profil_idx'
       and indexdef like '%organization_id, requested_at%' and indexdef like '%kind = ''profil''%'
  ) then
    raise exception 'index linkedin_requetes_profil_idx manquant ou de forme inattendue';
  end if;
end $$;

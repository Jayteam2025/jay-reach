-- L'empreinte de déduplication porte la commune, plus le seul code postal.
--
-- La composante géographique était le code postal. Or Adzuna ne le donne
-- jamais — son libellé de lieu est libre — et l'empreinte se réduisait alors à
-- l'entreprise et l'intitulé. Deux offres réelles au même intitulé dans deux
-- communes différentes portaient donc la même empreinte, et la seconde était
-- rejetée à l'insertion. Mesuré sur cette base le 01/09/2026 : 113 groupes
-- d'offres légitimes concernés, dont un employeur recrutant le même profil
-- dans douze communes — onze de ses offres auraient disparu sans laisser de
-- trace.
--
-- Ces fonctions doublent `signalFingerprint` de `packages/core`. Le worker
-- calcule l'empreinte en TypeScript pour ne pas payer un aller-retour par
-- signal ; le SQL sert au rattrapage des lignes déjà en base. Un test de
-- parité (`signal-filters.test.ts`) compare les deux sur des cas réels, sans
-- quoi elles divergeraient en silence.

-- Accents traités comme dans `normalize_agency_name`, faute d'extension
-- `unaccent` sur ce projet.
create or replace function public.signal_texte_normalise(entree text)
returns text
language sql
immutable
set search_path = 'public'
as $$
  select trim(regexp_replace(
    lower(translate(coalesce(entree, ''),
      'àáâäãåèéêëìíîïòóôöõùúûüñçÿýÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÑÇŸÝ',
      'aaaaaaeeeeiiiiooooouuuuncyyAAAAAAEEEEIIIIOOOOOUUUUNCYY')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- France Travail écrit « 44 - Rezé », Adzuna « Rezé, Loire-Atlantique ». On
-- retire le préfixe départemental et on garde le premier segment : le dernier
-- désigne l'arrondissement, et s'en servir confondrait deux communes voisines.
create or replace function public.signal_lieu_normalise(lieu text)
returns text
language sql
immutable
set search_path = 'public'
as $$
  select public.signal_texte_normalise(
    split_part(regexp_replace(coalesce(lieu, ''), '^\s*\d{2,3}\s*-\s*', ''), ',', 1));
$$;

create or replace function public.signal_empreinte(
  entreprise text, intitule text, lieu text)
returns text
language sql
immutable
set search_path = 'public'
as $$
  select case
    when coalesce(entreprise, '') = '' or coalesce(intitule, '') = '' then null
    when coalesce(nullif(public.signal_lieu_normalise(lieu), ''),
                  substring(coalesce(lieu, '') from '\d{5}')) is null then null
    else public.signal_texte_normalise(entreprise) || '|'
      || public.signal_texte_normalise(intitule) || '|'
      || coalesce(nullif(public.signal_lieu_normalise(lieu), ''),
                  substring(coalesce(lieu, '') from '\d{5}'))
  end;
$$;

-- Rattrapage : 2 836 signaux d'avant la déduplication n'avaient aucune
-- empreinte, et les 1 232 autres portaient l'ancienne règle. Une empreinte
-- absente ne se compare à rien — c'est ce qui laissait la collecte recréer
-- indéfiniment le jumeau d'un ancien signal.
update signals
   set fingerprint = public.signal_empreinte(company_hint, title, location)
 where fingerprint is distinct from public.signal_empreinte(company_hint, title, location);

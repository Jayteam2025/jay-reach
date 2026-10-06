-- Lot 4a, tâche 6 (suite) : ramener à la forme canonique les adresses de profil
-- LinkedIn DÉJÀ en base.
--
-- `normaliserUrlProfil` (packages/core) normalise ce qu'on ÉCRIT. Rien ne
-- normalisait l'existant : une fiche enregistrée sous `https://linkedin.com/in/x`
-- (sans `www.`) ou `…/in/x/` (barre finale) n'entre en conflit avec AUCUNE
-- écriture canonique du collecteur d'engageurs. Pas d'erreur, pas de 23505 :
-- une SECONDE fiche naît pour la même personne, silencieusement. C'est le
-- doublon que l'index unique `contacts_org_linkedin_url_uidx` ne peut pas voir.
--
-- Mesuré en lecture seule sur la base de l'éditeur le 06/10/2026 : 587 contacts,
-- 550 avec adresse, 15 non canoniques (8 sans `www.`, 7 avec barre finale), et
-- AUCUNE collision. Mais Jay Reach est auto-hébergé : cette migration tournera
-- sur des bases jamais vues, où deux fiches peuvent très bien converger vers la
-- même adresse. Elle ne doit donc jamais tomber — une migration qui échoue à
-- l'application est pire que le défaut qu'elle corrige.

-- Même règle que `normaliserUrlProfil` : hôte linkedin.com (ou sous-domaine de
-- pays), chemin `/in/<identifiant>`, sans paramètres, ancre ni barre finale.
-- Ce qui n'est pas un profil (page d'entreprise, saisie libre) n'est pas touché.
with cible as (
  select
    id,
    organization_id,
    linkedin_url,
    'https://www.linkedin.com/in/'
      || (regexp_match(linkedin_url, '^https?://(?:[a-z0-9-]+\.)?linkedin\.com/in/([^/?#]+)', 'i'))[1]
      as canonique
  from contacts
  where linkedin_url is not null
    and linkedin_url ~* '^https?://(?:[a-z0-9-]+\.)?linkedin\.com/in/[^/?#]+'
),
a_changer as (
  select * from cible where canonique <> linkedin_url
),
-- Deux fiches de la MÊME organisation qui convergent vers la même adresse
-- violeraient l'index unique. On n'en normalise qu'une ; l'autre garde sa forme
-- d'origine et reste visible pour un rapprochement ultérieur. Fusionner deux
-- fiches est une décision de l'opérateur, pas d'une migration.
une_par_adresse as (
  select distinct on (organization_id, canonique) id, organization_id, canonique
  from a_changer
  order by organization_id, canonique, id
)
update contacts c
   set linkedin_url = u.canonique
  from une_par_adresse u
 where c.id = u.id
   -- …ni une adresse qu'une AUTRE fiche porte déjà sous sa forme canonique.
   and not exists (
     select 1 from contacts autre
      where autre.organization_id = c.organization_id
        and autre.linkedin_url = u.canonique
        and autre.id <> c.id
   );

-- Contrôle : la migration échoue s'il reste une adresse normalisable qui
-- n'avait aucune raison de l'être. Une adresse laissée pour cause de collision
-- est acceptée, et annoncée.
do $$
declare
  v_restant int;
  v_collisions int;
begin
  with cible as (
    select
      id,
      organization_id,
      linkedin_url,
      'https://www.linkedin.com/in/'
        || (regexp_match(linkedin_url, '^https?://(?:[a-z0-9-]+\.)?linkedin\.com/in/([^/?#]+)', 'i'))[1]
        as canonique
    from contacts
    where linkedin_url is not null
      and linkedin_url ~* '^https?://(?:[a-z0-9-]+\.)?linkedin\.com/in/[^/?#]+'
  )
  select
    count(*) filter (
      where canonique <> linkedin_url
        and not exists (
          select 1 from contacts autre
           where autre.organization_id = cible.organization_id
             and autre.linkedin_url = cible.canonique
             and autre.id <> cible.id
        )
    ),
    count(*) filter (where canonique <> linkedin_url)
    into v_restant, v_collisions
  from cible;

  if v_restant > 0 then
    raise exception 'adresses LinkedIn non canoniques restantes sans collision : %', v_restant;
  end if;
  if v_collisions > 0 then
    raise notice 'adresses LinkedIn laissées telles quelles (une autre fiche porte déjà la forme canonique) : %', v_collisions;
  end if;
end $$;

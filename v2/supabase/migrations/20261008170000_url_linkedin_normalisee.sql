-- Lot 4b : l'opposition « ne pas contacter » ne doit plus tomber sur une barre oblique.
--
-- Les quatre endroits qui consultent une suppression `linkedin` comparaient deux chaînes
-- brutes (`lower(sup.value) = lower(c.linkedin_url)`). Or la même personne s'écrit de six
-- façons : avec ou sans `https://`, avec ou sans `www.`, avec ou sans barre finale, avec ou
-- sans paramètres de suivi (`?trk=...`). Une opposition saisie à la main sous une graphie
-- différente de celle du contact ne bloquait donc RIEN : l'opérateur croyait la personne
-- exclue et le message partait. C'est la promesse la plus forte de l'outil.
--
-- Les deux graphies coexistent déjà dans nos données : une ligne de file du 28/08 porte
-- `.../in/alexandredeclercq/`, le contact d'aujourd'hui `.../in/alexandredeclercq`.
--
-- Cette fonction est la MÊME règle que `normalizeLinkedin`
-- (`packages/core/src/import/pipeline.ts`), qui dédoublonne les imports : une seule
-- définition de « c'est la même adresse », des deux côtés du produit. Un contrôle du harnais
-- compare les deux implémentations sur la même liste de cas.
--
-- Lecture seule : aucune valeur existante n'est réécrite, donc rien à rejouer et aucun risque
-- sur les données. La normalisation est strictement PLUS LARGE que la comparaison d'avant
-- (tout ce qui correspondait correspond encore), elle ne peut donc pas laisser passer un envoi
-- qui était bloqué hier.

create schema if not exists app;

create or replace function app.url_linkedin_normalisee(valeur text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(btrim(valeur)), '^https?://', ''),
               '^www\.', ''),
             '\?.*$', ''),
           '/+$', '')
$$;

revoke all on function app.url_linkedin_normalisee(text) from public, anon, authenticated;
grant execute on function app.url_linkedin_normalisee(text) to service_role;

-- Contrôle : la migration se vérifie elle-même, sinon elle ne prouve rien d'autre que
-- « le fichier a été joué ».
do $$
declare
  v_attendu text := 'linkedin.com/in/jdoe';
  v_cas text[] := array[
    'https://www.linkedin.com/in/jdoe',
    'https://www.linkedin.com/in/jdoe/',
    'HTTPS://WWW.LinkedIn.com/in/JDoe',
    'http://linkedin.com/in/jdoe',
    'www.linkedin.com/in/jdoe',
    'linkedin.com/in/jdoe//',
    '  https://www.linkedin.com/in/jdoe?trk=public_profile  '
  ];
  v_cas_courant text;
  v_obtenu text;
begin
  foreach v_cas_courant in array v_cas loop
    v_obtenu := app.url_linkedin_normalisee(v_cas_courant);
    if v_obtenu is distinct from v_attendu then
      raise exception 'url_linkedin_normalisee(%) rend % au lieu de %', v_cas_courant, v_obtenu, v_attendu;
    end if;
  end loop;

  -- Deux personnes différentes ne doivent surtout pas se confondre.
  if app.url_linkedin_normalisee('https://www.linkedin.com/in/jdoe') = app.url_linkedin_normalisee('https://www.linkedin.com/in/jdoe2') then
    raise exception 'url_linkedin_normalisee confond deux profils distincts';
  end if;

  if app.url_linkedin_normalisee(null) is not null then
    raise exception 'url_linkedin_normalisee(null) devrait rendre null';
  end if;
end $$;

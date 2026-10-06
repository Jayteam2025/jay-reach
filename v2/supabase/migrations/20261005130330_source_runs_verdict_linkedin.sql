-- Lot 4a, tâche 7 (round 2 et 3) : ce qu'un passage dit de l'état du compte LinkedIn.
--
-- Vrai quand le passage a RÉELLEMENT parlé au monde extérieur ET que son résultat
-- est un verdict sur le compte ou sur sa sortie : collecte aboutie (elle remet le
-- disjoncteur à zéro), relève d'IP impossible (proxy mort), statut anormal, défi,
-- sortie inattendue.
--
-- Faux pour tout le reste, et chaque exclusion est voulue :
--  * refus locaux (canal désactivé, session, campagne en brouillon, persona ambigu,
--    verrou tenu, navigateur injoignable) : ils ne disent rien de LinkedIn ;
--  * plafonds : rien n'est émis ;
--  * post introuvable (404) et échecs de lecture de notre parseur : la requête a
--    abouti, LinkedIn a répondu normalement. Bloquer la session imposerait une
--    reconnexion — l'opération la plus risquée du lot — qui ne corrigerait ni une
--    adresse mal collée, ni un bug de parseur. Le disjoncteur protège le COMPTE
--    d'une activité répétée qui l'expose, pas notre code.
alter table source_runs add column if not exists verdict_linkedin boolean not null default false;

-- Contrôle : la migration échoue si la colonne attendue est absente.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'source_runs' and column_name = 'verdict_linkedin'
  ) then
    raise exception 'colonne manquante : source_runs.verdict_linkedin';
  end if;
end $$;

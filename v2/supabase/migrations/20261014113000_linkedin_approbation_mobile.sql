-- L'approbation sur l'application mobile devient un état que l'écran sait annoncer.
--
-- Mesuré le 14/10 : quand LinkedIn demande « Essayez-vous de vous identifier sur un autre
-- appareil ? », il n'y a aucun champ à remplir — l'opérateur doit toucher « Oui, c'est moi » sur
-- son téléphone. La notification lui parvient environ 20 s après la tentative, alors que le worker
-- abandonnait à 15 s : la demande était perdue d'avance, quoi qu'il fasse. Pire, l'écran ne lui
-- disait rien pendant ces quinze secondes, et ne parlait du téléphone qu'une fois l'échec consommé.
--
-- Le worker attend désormais trois minutes sur ce défi. Pour que l'écran puisse le dire pendant
-- l'attente, il lui faut un état, au même titre que `code_demande` : les deux listes fermées
-- l'accueillent ici.
--
-- Additive : aucune ligne existante ne porte cette valeur, et les valeurs déjà admises le restent.
-- Les deux contraintes sont recréées parce que Postgres ne sait pas étendre un `check` en place.

alter table public.linkedin_connexion_demandes
  drop constraint if exists linkedin_connexion_etape_liste_fermee;

alter table public.linkedin_connexion_demandes
  add constraint linkedin_connexion_etape_liste_fermee check (etape is null or etape in
    ('recue', 'sortie_controlee', 'navigateur_ouvert', 'identifiants_transmis',
     'code_demande', 'approbation_demandee', 'session_active'));

alter table public.linkedin_connexion_demandes
  drop constraint if exists linkedin_connexion_demandes_statut_check;

alter table public.linkedin_connexion_demandes
  add constraint linkedin_connexion_demandes_statut_check check (statut in
    ('demandee', 'navigateur_ouvert', 'code_demande', 'approbation_demandee', 'reussi', 'echec'));

-- La migration se vérifie elle-même : une liste recréée à la main perd une valeur en silence, et
-- le défaut ne se verrait qu'à la première connexion réelle, sur un écran bloqué. Le contrôle lit
-- la définition des contraintes plutôt que d'insérer une ligne témoin : rien n'est écrit, donc
-- rien ne peut rester derrière lui.
do $$
declare
  manquantes text := '';
  attendu record;
  def text;
begin
  for attendu in
    select *
    from (values
      ('linkedin_connexion_etape_liste_fermee', 'recue'),
      ('linkedin_connexion_etape_liste_fermee', 'sortie_controlee'),
      ('linkedin_connexion_etape_liste_fermee', 'navigateur_ouvert'),
      ('linkedin_connexion_etape_liste_fermee', 'identifiants_transmis'),
      ('linkedin_connexion_etape_liste_fermee', 'code_demande'),
      ('linkedin_connexion_etape_liste_fermee', 'approbation_demandee'),
      ('linkedin_connexion_etape_liste_fermee', 'session_active'),
      ('linkedin_connexion_demandes_statut_check', 'demandee'),
      ('linkedin_connexion_demandes_statut_check', 'navigateur_ouvert'),
      ('linkedin_connexion_demandes_statut_check', 'code_demande'),
      ('linkedin_connexion_demandes_statut_check', 'approbation_demandee'),
      ('linkedin_connexion_demandes_statut_check', 'reussi'),
      ('linkedin_connexion_demandes_statut_check', 'echec')
    ) as t(contrainte, valeur)
  loop
    select pg_get_constraintdef(con.oid) into def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'linkedin_connexion_demandes' and con.conname = attendu.contrainte;

    if def is null or position('''' || attendu.valeur || '''' in def) = 0 then
      manquantes := manquantes || ' ' || attendu.contrainte || '/' || attendu.valeur;
    end if;
  end loop;

  if manquantes <> '' then
    raise exception 'valeurs absentes des contraintes apres migration :%', manquantes;
  end if;
end $$;

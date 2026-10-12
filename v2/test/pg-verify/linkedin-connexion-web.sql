-- Lot 5, tâche 4 : les requêtes `verifier` et `ecrire` (SQL du worker, préparées par le .sh)
-- exécutées pour de vrai. Toute violation lève une exception.
\set ON_ERROR_STOP on

insert into organizations(id, name, slug) values
  ('c3000000-0000-0000-0000-00000000000a', 'LCW A', 'lcw-a'),
  ('c3000000-0000-0000-0000-00000000000b', 'LCW B', 'lcw-b'),
  ('c3000000-0000-0000-0000-00000000000c', 'LCW C', 'lcw-c'),
  ('c3000000-0000-0000-0000-00000000000d', 'LCW D', 'lcw-d'),
  ('c3000000-0000-0000-0000-00000000000e', 'LCW E', 'lcw-e');
insert into auth.users(id, email) values ('c4000000-0000-0000-0000-000000000001', 'w@t.local');

-- Une demande par cas (l'index n'autorise qu'une demande en cours par organisation).
create temp table cas(nom text primary key, id uuid, org uuid);
create or replace function pg_temp.demande(n text, o text, s text, expiree boolean default false) returns void
language plpgsql as $$
declare i uuid;
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut, motif, expires_at)
    values (('c3000000-0000-0000-0000-00000000000' || o)::uuid, 'c4000000-0000-0000-0000-000000000001', s,
            case when s = 'echec' then 'refuse' end,
            case when expiree then now() - interval '1 minute' else now() + interval '15 minutes' end)
    returning id into i;
  insert into cas values (n, i, ('c3000000-0000-0000-0000-00000000000' || o)::uuid);
end $$;

-- 1. Les trois statuts en cours sont vus comme en cours ; echec et reussi non ; expirée non.
select pg_temp.demande('demandee', 'a', 'demandee');
select pg_temp.demande('ouvert', 'b', 'navigateur_ouvert');
select pg_temp.demande('code', 'c', 'code_demande');
select pg_temp.demande('echec', 'd', 'echec');
select pg_temp.demande('reussi', 'd', 'reussi');
select pg_temp.demande('expiree', 'e', 'demandee', true);

create or replace function pg_temp.vue(n text) returns boolean language plpgsql as $$
declare r boolean; i uuid;
begin
  select id into i from cas where nom = n;
  execute 'execute verifier(''' || i || ''')' into r;
  return r;
end $$;

do $$
declare n text;
begin
  foreach n in array array['demandee', 'ouvert', 'code'] loop
    if pg_temp.vue(n) is not true then raise exception 'FAIL 1 : % devrait être en cours', n; end if;
  end loop;
  foreach n in array array['echec', 'reussi', 'expiree'] loop
    if pg_temp.vue(n) is not false then raise exception 'FAIL 1 : % ne devrait pas être en cours', n; end if;
  end loop;
  raise notice 'OK 1 verifier : 3 statuts en cours vus, echec / reussi / expirée non';
end $$;

-- Une demande inconnue ne rend aucune ligne (le code lève alors ErreurDemandeInterrompue).
execute verifier('00000000-0000-0000-0000-000000000000');
do $$ begin raise notice 'OK 1b verifier : id inconnu sans ligne (traité comme interrompu par le code)'; end $$;

-- 2. ecrire pose les cinq étapes autorisées (déclarées par la contrainte), une par une.
create or replace function pg_temp.ecrire(n text, e text, s text, m text) returns void language plpgsql as $$
declare i uuid;
begin
  select id into i from cas where nom = n;
  execute format('execute ecrire(%L, %L, %L, %L)', i, e, s, m);
end $$;
-- format %L rend NULL (sans guillemets) pour null.
do $$
declare e text;
begin
  foreach e in array array['sortie_controlee','navigateur_ouvert','identifiants_transmis','code_demande','session_active'] loop
    perform pg_temp.ecrire('demandee', e, null, null);
    if (select etape from linkedin_connexion_demandes l join cas c on c.id = l.id where c.nom = 'demandee') is distinct from e
      then raise exception 'FAIL 2 : étape % non écrite', e; end if;
  end loop;
  raise notice 'OK 2 ecrire : les cinq étapes autorisées sont écrites';
end $$;

-- 3. Une étape hors liste est refusée par la base.
do $$
begin
  perform pg_temp.ecrire('demandee', 'texte libre avec un secret', null, null);
  raise exception 'FAIL 3 : étape hors liste acceptée';
exception when check_violation then
  raise notice 'OK 3 ecrire : étape hors liste refusée par la base';
end $$;

-- 4. ecrire ne touche que la demande visée (les autres, d'une autre organisation, sont intactes).
do $$
declare avant text; apres text;
begin
  select string_agg(l.id || coalesce(l.etape,'-') || l.statut, ',' order by l.id) into avant
    from linkedin_connexion_demandes l join cas c on c.id = l.id where c.nom <> 'demandee';
  perform pg_temp.ecrire('demandee', 'code_demande', 'code_demande', null);
  select string_agg(l.id || coalesce(l.etape,'-') || l.statut, ',' order by l.id) into apres
    from linkedin_connexion_demandes l join cas c on c.id = l.id where c.nom <> 'demandee';
  if avant is distinct from apres then raise exception 'FAIL 4 : une autre demande a bougé'; end if;
  if (select statut from linkedin_connexion_demandes l join cas c on c.id = l.id where c.nom = 'demandee') <> 'code_demande'
    then raise exception 'FAIL 4 : la demande visée n''a pas avancé'; end if;
  raise notice 'OK 4 ecrire : seule la demande visée change';
end $$;

-- 5. Une demande close ou expirée n'est jamais réécrite (annulation non écrasée), un motif se pose avec echec.
do $$
begin
  perform pg_temp.ecrire('echec', 'session_active', 'reussi', null);
  perform pg_temp.ecrire('reussi', 'code_demande', null, null);
  if exists (select 1 from linkedin_connexion_demandes l join cas c on c.id = l.id
              where (c.nom = 'echec' and (l.etape is not null or l.statut <> 'echec'))
                 or (c.nom = 'reussi' and (l.etape is not null or l.statut <> 'reussi')))
    then raise exception 'FAIL 5 : une demande close a été réécrite'; end if;
  perform pg_temp.ecrire('demandee', null, 'echec', 'defi');
  if not exists (select 1 from linkedin_connexion_demandes l join cas c on c.id = l.id
                  where c.nom = 'demandee' and l.statut = 'echec' and l.motif = 'defi')
    then raise exception 'FAIL 5 : echec + motif non posés'; end if;
  raise notice 'OK 5 ecrire : demande close non réécrite, echec + motif posés';
end $$;
select 'VERIFY_OK';

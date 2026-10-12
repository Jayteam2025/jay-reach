-- Lot 5, tâche 2 : preuve sur Postgres que la table des demandes de connexion LinkedIn
-- refuse une seconde demande en cours (index unique), isole les organisations (RLS) et
-- n'accepte l'écriture que d'un admin ou d'un owner. Toute violation lève une exception.
\set ON_ERROR_STOP on

reset role;
insert into auth.users(id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'own@t.local'),
  ('c1000000-0000-0000-0000-000000000002', 'adm@t.local'),
  ('c1000000-0000-0000-0000-000000000003', 'vie@t.local'),
  ('c1000000-0000-0000-0000-000000000004', 'aut@t.local')
on conflict do nothing;
insert into organizations(id, name, slug) values
  ('c2000000-0000-0000-0000-00000000000a', 'LCD A', 'lcd-a'),
  ('c2000000-0000-0000-0000-00000000000b', 'LCD B', 'lcd-b');
insert into memberships(organization_id, user_id, role) values
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'owner'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'admin'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000003', 'viewer'),
  ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000004', 'owner');

-- 1. Un admin insère une demande ; la seconde en cours pour la même organisation est refusée.
set role authenticated;
select set_config('test.user_id', 'c1000000-0000-0000-0000-000000000002', false);
insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
  values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'demandee');
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'demandee');
  raise exception 'FAIL 1 : une seconde demande en cours a été acceptée';
exception when unique_violation then
  raise notice 'OK 1 index unique : seconde demande en cours refusée';
end $$;
-- Même refus quand la première est avancée (navigateur_ouvert, code_demande).
update linkedin_connexion_demandes set statut = 'code_demande'
  where organization_id = 'c2000000-0000-0000-0000-00000000000a';
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'navigateur_ouvert');
  raise exception 'FAIL 1b : demande concurrente acceptée pendant code_demande';
exception when unique_violation then
  raise notice 'OK 1b index unique : refus pendant code_demande';
end $$;

-- 2. Une fois terminée, une nouvelle demande est possible (l'index est partiel).
update linkedin_connexion_demandes set statut = 'echec', motif = 'refuse'
  where organization_id = 'c2000000-0000-0000-0000-00000000000a';
insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
  values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'demandee');
do $$ begin raise notice 'OK 2 nouvelle demande acceptée après un échec'; end $$;

-- 3. Les listes fermées : statut et motif hors liste refusés.
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut, motif)
    values ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000002', 'echec', 'x');
  raise exception 'FAIL 3 : insertion hors organisation / motif inconnu acceptée';
exception when check_violation or insufficient_privilege then
  raise notice 'OK 3 insertion invalide refusée';
end $$;
reset role;
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut, motif)
    values ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000004', 'echec', 'mot de passe: hunter2');
  raise exception 'FAIL 3b : motif hors liste fermée accepté';
exception when check_violation then
  raise notice 'OK 3b motif hors liste refusé';
end $$;
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000004', 'inconnu');
  raise exception 'FAIL 3c : statut hors liste accepté';
exception when check_violation then
  raise notice 'OK 3c statut hors liste refusé';
end $$;

-- 4. Un viewer lit mais ne peut pas insérer, modifier ni supprimer.
set role authenticated;
select set_config('test.user_id', 'c1000000-0000-0000-0000-000000000003', false);
do $$
begin
  if (select count(*) from linkedin_connexion_demandes
       where organization_id = 'c2000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'FAIL 4a : le viewer ne lit pas les demandes de son organisation';
  end if;
  raise notice 'OK 4a viewer : lecture';
end $$;
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000003', 'echec');
  raise exception 'FAIL 4b : un viewer a inséré';
exception when insufficient_privilege then
  raise notice 'OK 4b viewer : insertion refusée par la RLS';
end $$;
do $$
declare n int;
begin
  update linkedin_connexion_demandes set statut = 'echec', motif = 'annulee';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4c : un viewer a modifié % ligne(s)', n; end if;
  delete from linkedin_connexion_demandes;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 4d : un viewer a supprimé % ligne(s)', n; end if;
  raise notice 'OK 4c/4d viewer : modification et suppression sans effet';
end $$;

-- 5. Un admin ne peut pas poser une demande au nom d'un autre.
select set_config('test.user_id', 'c1000000-0000-0000-0000-000000000001', false);
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'echec');
  raise exception 'FAIL 5 : demande posée au nom d''un autre';
exception when insufficient_privilege then
  raise notice 'OK 5 demandee_par doit être l''appelant';
end $$;

-- 6. Isolation : un membre de l'autre organisation ne voit rien et n'écrit pas chez A.
select set_config('test.user_id', 'c1000000-0000-0000-0000-000000000004', false);
do $$
begin
  if (select count(*) from linkedin_connexion_demandes) <> 0 then
    raise exception 'FAIL 6a : un membre de B voit des demandes de A';
  end if;
  raise notice 'OK 6a isolation en lecture';
end $$;
do $$
begin
  insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
    values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000004', 'echec');
  raise exception 'FAIL 6b : B a inséré chez A';
exception when insufficient_privilege then
  raise notice 'OK 6b isolation en écriture';
end $$;
-- ... mais B (owner de B) peut avoir SA demande en cours, indépendante de celle de A.
insert into linkedin_connexion_demandes(organization_id, demandee_par, statut)
  values ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000004', 'demandee');
do $$ begin raise notice 'OK 6c l''unicité est PAR organisation'; end $$;

-- 7. La purge : n'est pas appelable par un utilisateur ; côté service, elle passe les
-- demandes expirées en échec `delai` et supprime les terminées depuis plus de 24 h.
do $$
begin
  perform public.purger_linkedin_connexion_demandes();
  raise exception 'FAIL 7a : un authenticated a appelé la purge';
exception when insufficient_privilege then
  raise notice 'OK 7a purge refusée à authenticated';
end $$;
reset role;
update linkedin_connexion_demandes set updated_at = now() - interval '25 hours'
  where organization_id = 'c2000000-0000-0000-0000-00000000000a' and statut = 'echec';
update linkedin_connexion_demandes set expires_at = now() - interval '1 minute'
  where organization_id = 'c2000000-0000-0000-0000-00000000000b';
set role service_role;
do $$
declare n int;
begin
  n := public.purger_linkedin_connexion_demandes();
  if n <> 1 then raise exception 'FAIL 7b : % ligne(s) supprimée(s), 1 attendue', n; end if;
  if (select count(*) from linkedin_connexion_demandes
       where organization_id = 'c2000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL 7c : la demande en cours de A a été touchée';
  end if;
  if (select motif from linkedin_connexion_demandes
       where organization_id = 'c2000000-0000-0000-0000-00000000000b') is distinct from 'delai' then
    raise exception 'FAIL 7d : la demande expirée de B n''est pas passée en échec delai';
  end if;
  raise notice 'OK 7b/7c/7d purge : terminée à 24 h supprimée, en cours conservée, expirée -> delai';
end $$;
reset role;
select 'VERIFY_OK' as resultat;

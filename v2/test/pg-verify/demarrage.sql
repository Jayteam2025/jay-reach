-- Lot 5, tâche 9 : la requête des six vérités, jouée contre un vrai Postgres.
-- Ce qu'elle doit prouver : chaque compte lit la bonne table avec le bon filtre, et AUCUN
-- compte ne traverse la frontière d'organisation.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

insert into organizations (id, name, slug) values (:'A', 'Org A', 'org-a'), (:'B', 'Org B', 'org-b');

-- Org A : tout est branché. Org B : rien, et des lignes qui NE doivent pas compter pour A.
insert into credentials (organization_id, provider_id, status) values (:'A', 'anthropic', 'configured');
insert into credentials (organization_id, provider_id, status) values (:'B', 'anthropic', 'configured');
insert into senders (organization_id, kind, identity, display_name, is_active)
  values (:'A', 'email', 'a@exemple.fr', 'A', true),
         (:'A', 'email', 'inactive@exemple.fr', 'A inactive', false),
         (:'A', 'linkedin', 'a-linkedin', 'A LinkedIn', true),
         (:'B', 'email', 'b@exemple.fr', 'B', true);
insert into personas (organization_id, name) values (:'A', 'Directeur commercial');
insert into sources (organization_id, provider_id, name, is_active)
  values (:'A', 'adzuna', 'Source A', true),
         (:'A', 'adzuna', 'Source A éteinte', false),
         (:'B', 'adzuna', 'Source B', true);
insert into campaigns (organization_id, name, status, entry_rules)
  values (:'A', 'Campagne A', 'active', '{}'), (:'A', 'Brouillon A', 'draft', '{}'),
         (:'B', 'Campagne B', 'active', '{}');
insert into linkedin_server_sessions (organization_id, status) values (:'A', 'active');

do $$
declare r record;
begin
  execute format('execute demarrage(%L)', '11111111-1111-1111-1111-111111111111') into r;
  -- 1 : les comptes d'A, sans un seul emprunt à B.
  if r.cles <> 1 then raise exception 'FAIL 1a : cles = %, attendu 1 (B ne doit pas compter)', r.cles; end if;
  if r.boites <> 1 then raise exception 'FAIL 1b : boites = %, attendu 1 (ni la boite inactive, ni celle de B, ni le sender linkedin)', r.boites; end if;
  if r.personas <> 1 then raise exception 'FAIL 1c : personas = %, attendu 1', r.personas; end if;
  if r.sources <> 1 then raise exception 'FAIL 1d : sources = %, attendu 1 (la source eteinte ne compte pas)', r.sources; end if;
  if r.campagnes <> 1 then raise exception 'FAIL 1e : campagnes = %, attendu 1 (le brouillon ne compte pas)', r.campagnes; end if;
  if r.linkedin_statut is distinct from 'active' then raise exception 'FAIL 1f : statut linkedin = %', r.linkedin_statut; end if;
  raise notice 'OK 1 : les six comptes d''A sont justes, sans fuite depuis B';
end $$;

do $$
declare r record;
begin
  execute format('execute demarrage(%L)', '22222222-2222-2222-2222-222222222222') into r;
  -- 2 : B n'a ni persona, ni session, et ne voit rien de A.
  if r.personas <> 0 then raise exception 'FAIL 2a : personas de B = %, attendu 0', r.personas; end if;
  if r.linkedin_statut is not null then raise exception 'FAIL 2b : B a un statut LinkedIn = %', r.linkedin_statut; end if;
  if r.boites <> 1 then raise exception 'FAIL 2c : boites de B = %, attendu 1', r.boites; end if;
  raise notice 'OK 2 : une organisation sans persona ni session le dit, et ne voit rien de l''autre';
end $$;

do $$
declare r record;
begin
  -- 3 : une session bloquée n'est pas une session absente — c'est ce qui fait revenir le bloc.
  -- La contrainte du schéma exige un motif avec le statut bloquée : on dit la vérité.
  update linkedin_server_sessions
     set status = 'bloquee', blocked_at = now(), blocked_reason = 'defi'
   where organization_id = '11111111-1111-1111-1111-111111111111';
  execute format('execute demarrage(%L)', '11111111-1111-1111-1111-111111111111') into r;
  if r.linkedin_statut is distinct from 'bloquee' then
    raise exception 'FAIL 3 : statut rendu = %, attendu bloquee', r.linkedin_statut;
  end if;
  raise notice 'OK 3 : une session bloquee est rendue telle quelle, pas comme une absence';
end $$;

select 'VERIFY_OK' as resultat;

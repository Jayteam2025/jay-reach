-- Lot 5, tâche 9 : la requête des six vérités, jouée contre un vrai Postgres.
-- Ce qu'elle doit prouver : chaque compte lit la bonne table avec le bon filtre, et AUCUN
-- compte ne traverse la frontière d'organisation.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'

insert into organizations (id, name, slug) values (:'A', 'Org A', 'org-a'), (:'B', 'Org B', 'org-b');

-- Org A : tout est branché. Org B : rien, et des lignes qui NE doivent pas compter pour A.
insert into credentials (organization_id, provider_id, status) values (:'A', 'anthropic', 'configured');
-- Une clé déclarée mais jamais posée ne doit pas faire passer la ligne au vert (spec §13).
insert into credentials (organization_id, provider_id, status) values (:'A', 'fullenrich', 'unconfigured');
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
         (:'A', 'adzuna', 'Source A orpheline', true),
         (:'A', 'adzuna', 'Source A en pause', true),
         (:'B', 'adzuna', 'Source B', true);
insert into campaigns (organization_id, name, status, entry_rules)
  values (:'A', 'Campagne A', 'active', '{}'), (:'A', 'Brouillon A', 'draft', '{}'),
         (:'A', 'Active sans étape A', 'active', '{}'), (:'A', 'Pause A', 'paused', '{}'),
         (:'B', 'Campagne B', 'active', '{}');
-- Une campagne lancée a de quoi envoyer : seule « Campagne A » (et celle de B) porte une étape.
insert into sequence_steps (campaign_id, position, channel)
  select id, 1, 'email' from campaigns where name in ('Campagne A', 'Campagne B');
-- Les sources ne comptent que reliées à une campagne vivante (brouillon ou active) :
-- « éteinte » est reliée mais inactive, « orpheline » n'est reliée à rien, « en pause » n'est
-- reliée qu'à une campagne en pause, et celle de B appartient à l'autre organisation.
insert into campaign_sources (campaign_id, source_id)
  select c.id, s.id from campaigns c, sources s
   where (c.name = 'Campagne A' and s.name in ('Source A', 'Source A éteinte'))
      or (c.name = 'Pause A' and s.name = 'Source A en pause')
      or (c.name = 'Campagne B' and s.name = 'Source B');
insert into linkedin_server_sessions (organization_id, status) values (:'A', 'active');

do $$
declare r record;
begin
  execute format('execute demarrage(%L)', '11111111-1111-1111-1111-111111111111') into r;
  -- 1 : les comptes d'A, sans un seul emprunt à B.
  if r.cles <> 1 then raise exception 'FAIL 1a : cles = %, attendu 1 (ni celle de B, ni une cle unconfigured)', r.cles; end if;
  if r.boites <> 1 then raise exception 'FAIL 1b : boites = %, attendu 1 (ni la boite inactive, ni celle de B, ni le sender linkedin)', r.boites; end if;
  if r.personas <> 1 then raise exception 'FAIL 1c : personas = %, attendu 1', r.personas; end if;
  if r.sources <> 1 then raise exception 'FAIL 1d : sources = %, attendu 1 (ni l''eteinte, ni l''orpheline, ni celle d''une campagne en pause, ni celle de B)', r.sources; end if;
  if r.campagnes <> 1 then raise exception 'FAIL 1e : campagnes = %, attendu 1 (ni le brouillon, ni la pause, ni l''active sans etape, ni celle de B)', r.campagnes; end if;
  if r.brouillons <> 1 then raise exception 'FAIL 1g : brouillons = %, attendu 1 (le brouillon de A, pas celui de personne d''autre)', r.brouillons; end if;
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
  if r.sources <> 1 or r.campagnes <> 1 or r.brouillons <> 0 then
    raise exception 'FAIL 2d : B = % sources, % campagnes, % brouillons, attendu 1/1/0', r.sources, r.campagnes, r.brouillons;
  end if;
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
  if r.linkedin_statut is distinct from 'bloquee' or r.linkedin_motif is distinct from 'defi' then
    raise exception 'FAIL 3 : statut = %, motif = %, attendu bloquee/defi', r.linkedin_statut, r.linkedin_motif;
  end if;
  raise notice 'OK 3 : une session bloquee rend son statut ET son motif';
end $$;

do $$
declare r record;
begin
  -- 4 : une deconnexion VOULUE s'ecrit avec le meme statut qu'une panne. Seul le motif les
  -- distingue, et c'est lui qui evite a l'accueil de titrer « un branchement a lache » quand
  -- l'operateur vient de cliquer « Deconnecter ».
  update linkedin_server_sessions set status = 'bloquee', blocked_at = now(), blocked_reason = 'revoquee'
   where organization_id = '11111111-1111-1111-1111-111111111111';
  execute format('execute demarrage(%L)', '11111111-1111-1111-1111-111111111111') into r;
  if r.linkedin_motif is distinct from 'revoquee' then
    raise exception 'FAIL 4 : motif rendu = %, attendu revoquee', r.linkedin_motif;
  end if;
  raise notice 'OK 4 : une deconnexion voulue est distinguee par son motif, pas par son statut';
end $$;

select 'VERIFY_OK' as resultat;

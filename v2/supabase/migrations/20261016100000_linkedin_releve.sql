-- Socle en base de la relève des réponses LinkedIn.
--
-- 1. `linkedin_requetes` : une relève de messagerie est une requête LinkedIn comme une autre et
--    compte dans le même budget, mais elle ne se rattache ni à un passage de collecte, ni à une
--    action d'envoi, ni à une fiche de post. La contrainte « exactement une origine » devient :
--    zéro origine UNIQUEMENT pour `kind = 'messagerie'` et `kind = 'resolution_profil'` (la résolution
--    d'URN de la relève : un profil ouvert hors de toute collecte ; elle compte dans le plafond de
--    visites de profil), exactement une dans tous les autres cas
--    (y compris `kind` nul, celui des traces de collecte existantes). Un simple `<= 1` laisserait
--    passer une trace de collecte orpheline.
-- 2. `linkedin_server_sessions` : curseur de relève et compte connecté lors du dernier passage.
--    Le curseur naît NUL (« rien avant la mise en route ») : la lecture le traduit en now() au
--    premier passage. Ne pas le pré-remplir ici, la date de la migration deviendrait la date de
--    mise en route.
-- 3. `linkedin_action_queue.origine` : une action née d'une réponse d'opérateur se distingue de
--    celle d'une séquence.
-- 5. `contacts.urn_tentee_le` : date du dernier échec DÉFINITIF de résolution de l'URN (profil introuvable,
--    adresse qui n'est pas une page de profil). Sans elle, un contact irrésoluble reste en tête de la file
--    de résolution et le passage ne résout plus personne d'autre. Nullable, sans défaut : aucune ligne
--    existante n'est touchée. Les échecs passagers (réseau, 5xx, refus de session) ne la posent jamais.
-- 4. `threads` : un seul fil par contact et par canal, tenu par un index et non plus par le seul
--    code (select puis insert), qui laissait deux passages concurrents créer deux fils. Les
--    doublons existants sont FUSIONNÉS vers le fil le plus ancien avant de poser l'index : un
--    message perdu ne se retrouve pas.

-- 1. Origine des traces de requête
alter table public.linkedin_requetes drop constraint if exists linkedin_requetes_une_origine;
alter table public.linkedin_requetes
  add constraint linkedin_requetes_une_origine
  check (
    case
      when kind in ('messagerie', 'resolution_profil') then num_nonnulls(source_run_id, action_queue_id, post_id) <= 1
      else num_nonnulls(source_run_id, action_queue_id, post_id) = 1
    end
  );

-- Le plafond de visites de profil compte `kind in ('profil', 'resolution_profil')`. L'index partiel
-- `linkedin_requetes_profil_idx` (20261014140000, `where kind = 'profil'`) ne sert plus cette requête :
-- le planificateur ne peut l'utiliser que si le prédicat de la requête IMPLIQUE celui de l'index, et
-- `kind in (...)` n'implique pas `kind = 'profil'`. Même forme, prédicat élargi ; l'ancien reste (il est
-- dans une migration déjà appliquée, dont l'auto-contrôle le réclame), il ne sert plus que d'ancêtre.
create index if not exists linkedin_requetes_visites_idx
  on public.linkedin_requetes (organization_id, requested_at)
  where kind in ('profil', 'resolution_profil');

-- 2. Curseur de relève
-- Mémoire de l'état d'AVANT : la colonne est-elle créée par CETTE exécution ? Le contrôle final « le curseur
-- n'est pas pré-rempli » n'a de sens que dans ce cas. Une réapplication (les migrations v2 s'appliquent à la
-- main, sans être tracées) trouve des curseurs légitimement posés par la relève, et ne doit pas échouer.
drop table if exists pg_temp._releve_curseur_neuf;
create temp table _releve_curseur_neuf as
  select not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_server_sessions'::regclass
       and attname = 'releve_curseur_at' and not attisdropped
  ) as neuf;

alter table public.linkedin_server_sessions
  add column if not exists releve_curseur_at timestamptz,
  add column if not exists releve_compte_urn text;
-- `releve_compte_urn` n'est PAS un doublon de `account_urn` (migration 20261008180000) : `account_urn` est le
-- dernier compte VU par n'importe qui (un envoi, la relève), `releve_compte_urn` le compte auquel le CURSEUR
-- appartient. Un envoi qui passe sous un autre compte met `account_urn` à jour sans toucher le curseur ; la relève
-- compare avec sa propre mémoire, sinon ses messages sortants passeraient pour des réponses. Même forme dans les
-- deux (l'identifiant brut de `/me`).
comment on column public.linkedin_server_sessions.releve_compte_urn is
  'Compte LinkedIn auquel appartient releve_curseur_at (relève des réponses). Distinct de account_urn, dernier compte vu par un envoi ou la relève.';

-- 3. Origine d'une action en file
alter table public.linkedin_action_queue
  add column if not exists origine text not null default 'sequence';
alter table public.linkedin_action_queue drop constraint if exists linkedin_action_queue_origine_check;
alter table public.linkedin_action_queue
  add constraint linkedin_action_queue_origine_check check (origine in ('sequence', 'reponse'));

-- 5. Mémoire des échecs de résolution d'URN
alter table public.contacts add column if not exists urn_tentee_le timestamptz;

-- 4. Un fil par contact et par canal : fusion des doublons, puis index unique partiel.
--    Le fil conservé est le plus ancien (created_at, puis id pour départager).
--    Choix assumé, pas un oubli : seuls les messages et l'état lu/traité/dernier message sont repris
--    du fil supprimé. `classification`, `assigned_to`, `resume_at` et `provider_thread_id` du fil
--    supprimé sont PERDUS ; le fil conservé garde les siens.
--    Verrou posé AVANT la fusion et tenu jusqu'à la fin de l'instruction : un passage concurrent ne
--    peut pas recréer un doublon entre la fusion et la création de l'index (qui échouerait). Le tout
--    tient dans UN bloc `do`, donc dans une seule transaction même hors `db push -1` (un `lock`
--    isolé est refusé hors transaction).
do $fusion$
begin
lock table public.threads in share row exclusive mode;

drop table if exists pg_temp._fils_doublons;
create temp table _fils_doublons as
select id,
       first_value(id) over (
         partition by organization_id, contact_id, channel order by created_at, id
       ) as garde_id
  from public.threads
 where contact_id is not null;

delete from _fils_doublons where id = garde_id;

update public.thread_messages m
   set thread_id = d.garde_id
  from _fils_doublons d
 where m.thread_id = d.id;

-- Le fil conservé reprend l'état agrégé : lu seulement si tous l'étaient, traité seulement si tous
-- l'étaient, dernier message le plus récent. Le plus prudent pour qu'une réponse ne passe pas
-- inaperçue.
update public.threads t
   set last_message_at = coalesce((select max(m.sent_at) from public.thread_messages m where m.thread_id = t.id), t.last_message_at),
       is_read = t.is_read and not exists (
         select 1 from _fils_doublons d join public.threads x on x.id = d.id where d.garde_id = t.id and not x.is_read
       ),
       handled_at = case
         when exists (
           select 1 from _fils_doublons d join public.threads x on x.id = d.id
            where d.garde_id = t.id and x.handled_at is null
         ) then null else t.handled_at end
 where t.id in (select garde_id from _fils_doublons);

delete from public.threads t using _fils_doublons d where t.id = d.id;

drop table pg_temp._fils_doublons;

create unique index if not exists threads_un_fil_par_contact_et_canal
  on public.threads (organization_id, contact_id, channel)
  where contact_id is not null;
end $fusion$;

-- Contrôles : la migration échoue si l'un manque, ou si la contrainte n'a pas la forme voulue.
do $$
declare
  v_ok boolean;
begin
  if (select count(*) from pg_attribute
       where attrelid = 'public.linkedin_server_sessions'::regclass
         and attname in ('releve_curseur_at', 'releve_compte_urn') and not attisdropped) <> 2 then
    raise exception 'colonnes de relève absentes de linkedin_server_sessions';
  end if;
  if (select neuf from pg_temp._releve_curseur_neuf)
     and exists (select 1 from public.linkedin_server_sessions where releve_curseur_at is not null) then
    raise exception 'le curseur de relève ne doit pas être pré-rempli';
  end if;
  drop table if exists pg_temp._releve_curseur_neuf;

  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.contacts'::regclass and attname = 'urn_tentee_le'
       and not attnotnull and not attisdropped
  ) or exists (
    select 1 from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.contacts'::regclass and a.attname = 'urn_tentee_le'
  ) then
    raise exception 'colonne contacts.urn_tentee_le absente, non nullable, ou avec un defaut';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_action_queue'::regclass and attname = 'origine'
       and attnotnull and not attisdropped
  ) then
    raise exception 'colonne linkedin_action_queue.origine absente ou nullable';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.linkedin_action_queue'::regclass and conname = 'linkedin_action_queue_origine_check'
  ) then
    raise exception 'contrainte linkedin_action_queue_origine_check absente';
  end if;

  -- 1.c : la contrainte d'origine, jouée sur une copie (CHECK seulement, aucune clé étrangère).
  drop table if exists pg_temp._origine_test;
  create temp table _origine_test (like public.linkedin_requetes including defaults including constraints);
  -- messagerie sans origine : admise
  insert into _origine_test (id, organization_id, kind) values (1, gen_random_uuid(), 'messagerie');
  -- une origine, kind nul (trace de collecte existante) : admise
  insert into _origine_test (id, organization_id, source_run_id) values (2, gen_random_uuid(), gen_random_uuid());
  -- zéro origine, kind nul : REFUSÉE (trace de collecte orpheline)
  v_ok := false;
  begin
    insert into _origine_test (id, organization_id) values (3, gen_random_uuid());
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'linkedin_requetes_une_origine admet une trace de collecte orpheline (kind nul)'; end if;
  -- zéro origine, autre kind : REFUSÉE
  v_ok := false;
  begin
    insert into _origine_test (id, organization_id, kind) values (4, gen_random_uuid(), 'fiche');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'linkedin_requetes_une_origine admet une trace orpheline de kind fiche'; end if;
  -- deux origines : REFUSÉE
  v_ok := false;
  begin
    insert into _origine_test (id, organization_id, source_run_id, post_id) values (5, gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'linkedin_requetes_une_origine admet deux origines'; end if;
  -- résolution d'URN de la relève sans origine : admise ; avec deux origines : REFUSÉE
  insert into _origine_test (id, organization_id, kind) values (6, gen_random_uuid(), 'resolution_profil');
  v_ok := false;
  begin
    insert into _origine_test (id, organization_id, kind, source_run_id, post_id) values (7, gen_random_uuid(), 'resolution_profil', gen_random_uuid(), gen_random_uuid());
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'linkedin_requetes_une_origine admet une résolution de profil à deux origines'; end if;
  -- la collecte (kind profil) garde son origine obligatoire
  v_ok := false;
  begin
    insert into _origine_test (id, organization_id, kind) values (8, gen_random_uuid(), 'profil');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'linkedin_requetes_une_origine admet une trace orpheline de kind profil'; end if;
  drop table pg_temp._origine_test;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'linkedin_requetes' and indexname = 'linkedin_requetes_visites_idx'
       and indexdef like '%resolution_profil%'
  ) then
    raise exception 'index linkedin_requetes_visites_idx manquant ou de forme inattendue';
  end if;

  -- 4 : plus aucun doublon, index unique partiel de la bonne forme
  if exists (
    select 1 from public.threads where contact_id is not null
     group by organization_id, contact_id, channel having count(*) > 1
  ) then
    raise exception 'des fils en double subsistent';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'threads' and indexname = 'threads_un_fil_par_contact_et_canal'
       and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%contact_id IS NOT NULL%'
  ) then
    raise exception 'index threads_un_fil_par_contact_et_canal manquant ou de forme inattendue';
  end if;
  -- aucun message orphelin après la fusion
  if exists (select 1 from public.thread_messages m where not exists (select 1 from public.threads t where t.id = m.thread_id)) then
    raise exception 'des messages orphelins après la fusion des fils';
  end if;
end $$;

-- Lot 4b : la déduplication de la file LinkedIn suit l'ACTION, pas le couple (contact, type) à vie.
--
-- `uq_linkedin_action_active` interdisait toute seconde ligne active pour un même
-- (contact, type), sans limite de temps. Une ligne `sent` posée en août par l'ancienne
-- extension suffisait donc à refuser un message tout neuf : l'action restait `scheduled`
-- à jamais, l'inscription passait `completed`, et l'écran annonçait « Aucune action en
-- attente ». Résultat : pas de séquence LinkedIn à deux messages, et toute personne déjà
-- touchée par l'extension définitivement injoignable.
--
-- La règle non négociable est « jamais deux envois pour UNE action ». Donc :
--   * `invite` : on garde (contact, type) sans limite de temps, on n'invite pas deux fois
--     la même personne ;
--   * tout type : une action du séquenceur ne produit qu'une ligne active (`action_id`
--     est nullable, les lignes historiques de l'extension n'en ont pas : index partiel).
--
-- Additive et idempotente : les index sont recréés. Si des lignes existantes violent déjà
-- une des contraintes, la migration ÉCHOUE avec leur nombre au lieu de laisser
-- `create unique index` planter sans explication.

do $$
declare
  v_doublons int;
begin
  select count(*) into v_doublons from (
    select action_id
      from linkedin_action_queue
     where action_id is not null
       and (status in ('pending', 'processing', 'sent')
            or (status = 'failed' and error_code = 'resultat_indetermine'))
     group by action_id
    having count(*) > 1
  ) d;
  if v_doublons > 0 then
    raise exception 'linkedin_action_queue : % action(s) ont déjà plusieurs lignes actives ou indéterminées : à traiter avant cette migration', v_doublons;
  end if;
end $$;

-- La contrainte (contact, type) ne s'applique plus qu'aux invitations. Plus étroite que
-- l'ancienne : aucune ligne existante ne peut la violer si l'ancienne tenait.
drop index if exists uq_linkedin_action_active;
create unique index uq_linkedin_action_active
  on linkedin_action_queue (contact_id, kind)
  where kind = 'invite'
    and contact_id is not null
    and (status in ('pending', 'processing', 'sent')
         or (status = 'failed' and error_code = 'resultat_indetermine'));

drop index if exists uq_linkedin_action_par_action;
create unique index uq_linkedin_action_par_action
  on linkedin_action_queue (action_id)
  where action_id is not null
    and (status in ('pending', 'processing', 'sent')
         or (status = 'failed' and error_code = 'resultat_indetermine'));

-- Contrôle : les deux index existent, sont uniques, et portent le prédicat voulu.
do $$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uq_linkedin_action_active';
  if v_def is null or v_def not like 'CREATE UNIQUE INDEX%'
     or v_def not like '%invite%' or v_def not like '%resultat_indetermine%' then
    raise exception 'uq_linkedin_action_active absent ou non restreint aux invitations : %', coalesce(v_def, 'absent');
  end if;

  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uq_linkedin_action_par_action';
  if v_def is null or v_def not like 'CREATE UNIQUE INDEX%'
     or v_def not like '%(action_id)%' or v_def not like '%action_id IS NOT NULL%'
     or v_def not like '%resultat_indetermine%' then
    raise exception 'uq_linkedin_action_par_action absent ou sans son prédicat : %', coalesce(v_def, 'absent');
  end if;
end $$;

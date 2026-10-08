-- Lot 4b : une action serveur au résultat indéterminé compte comme ACTIVE.
--
-- Quand le worker meurt entre le POST et l'enregistrement du résultat, la ligne passe
-- `failed / resultat_indetermine` : l'invitation a peut-être été reçue. L'index unique
-- `uq_linkedin_action_active` et les déduplications d'enfilement ne voyaient que
-- pending / processing / sent, donc pour le reste du système cette personne n'avait
-- jamais été contactée, et rien n'empêchait de la réinviter.
--
-- Additive : l'index est recréé avec un prédicat élargi. Si des lignes existantes
-- violent déjà la contrainte élargie, la migration ÉCHOUE avec leur nombre au lieu de
-- laisser `create unique index` planter sans explication.

do $$
declare
  v_doublons int;
begin
  select count(*) into v_doublons from (
    select contact_id, kind
      from linkedin_action_queue
     where contact_id is not null
       and (status in ('pending', 'processing', 'sent')
            or (status = 'failed' and error_code = 'resultat_indetermine'))
     group by contact_id, kind
    having count(*) > 1
  ) d;
  if v_doublons > 0 then
    raise exception 'linkedin_action_queue : % couple(s) (contact, type) ont déjà plusieurs actions actives ou indéterminées : à traiter avant cette migration', v_doublons;
  end if;
end $$;

drop index if exists uq_linkedin_action_active;
create unique index uq_linkedin_action_active
  on linkedin_action_queue (contact_id, kind)
  where contact_id is not null
    and (status in ('pending', 'processing', 'sent')
         or (status = 'failed' and error_code = 'resultat_indetermine'));

-- Contrôle : l'index existe, est unique, et porte bien le cas indéterminé.
do $$
declare
  v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uq_linkedin_action_active';
  if v_def is null or v_def not like 'CREATE UNIQUE INDEX%' or v_def not like '%resultat_indetermine%' then
    raise exception 'uq_linkedin_action_active absent ou sans le cas resultat_indetermine : %', coalesce(v_def, 'absent');
  end if;
end $$;

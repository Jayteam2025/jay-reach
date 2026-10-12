-- Lot 5, tâche 6 (reprise de relecture) : deux garanties rendues STRUCTURELLES.
--
-- 1. Une seule ligne `senders` active de genre `linkedin` par organisation. `resolveSender` lie chaque
--    contact à vie à son expéditeur et les plafonds se comptent par ligne : deux lignes actives pour un
--    même compte réel feraient envoyer le double du plafond, donc restreindre le compte par LinkedIn.
--    Tenue jusqu'ici par le seul verrou applicatif de `garantirExpediteurLinkedIn` ; l'ancien chemin
--    (`synchroniserExpediteurLinkedIn`, extension) pouvait en créer une seconde. Désormais la base refuse.
-- 2. L'intention de déconnexion est PERSISTÉE (`deconnexion_demandee_at`) : un report gardé en mémoire
--    du worker mourait avec lui, et le message `pg_notify` n'est pas rejoué.
--
-- Additive. L'index échoue, avec un message lisible, si une organisation porte déjà deux lignes actives.

alter table linkedin_server_sessions
  add column if not exists deconnexion_demandee_at timestamptz;

comment on column linkedin_server_sessions.deconnexion_demandee_at is
  'Quand une déconnexion a été demandée et n''a pas encore abouti (cookies effacés, expéditeur désactivé). Nulle sinon. Le worker la reprend au démarrage et à la fin d''une connexion.';

do $$
declare
  v_doublons text;
begin
  select string_agg(organization_id::text || ' (' || n || ')', ', ') into v_doublons
    from (select organization_id, count(*) n from senders
           where kind = 'linkedin' and is_active group by organization_id having count(*) > 1) d;
  if v_doublons is not null then
    raise exception 'senders : plusieurs lignes LinkedIn actives, à désactiver avant cette migration : %', v_doublons;
  end if;
end $$;

create unique index if not exists senders_un_linkedin_actif_par_organisation
  on senders (organization_id) where kind = 'linkedin' and is_active;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'senders_un_linkedin_actif_par_organisation') then
    raise exception 'index senders_un_linkedin_actif_par_organisation manquant apres migration';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'linkedin_server_sessions' and column_name = 'deconnexion_demandee_at') then
    raise exception 'linkedin_server_sessions.deconnexion_demandee_at manquante apres migration';
  end if;
end $$;

-- Lot 4b : « Reprendre » une inscription arrêtée par un refus LinkedIn doit faire repartir l'action.
--
-- Jusqu'ici la reprise repassait l'action `failed` en `scheduled` et laissait `next_action_at` nul,
-- en comptant sur un départ réel qui n'existait que pour l'email. Pour LinkedIn, rien ne
-- réenfilait la ligne de file : l'inscription redevenait active et plus rien ne partait, sans message.
--
-- `reprise_le` MARQUE la ligne de file qu'un humain a reprise. On n'efface rien (l'historique du
-- refus reste lisible). Seule une ligne marquée peut être réenfilée par le balayage du worker ;
-- une ligne `failed` non reprise ne repart jamais seule, et `resultat_indetermine` (l'envoi est
-- peut-être parti) n'est jamais marquée : la reprise refuse de la rejouer.
--
-- Additive et idempotente. La migration se vérifie elle-même : elle échoue si la colonne ou
-- l'index manquent.

alter table linkedin_action_queue add column if not exists reprise_le timestamptz;

create index if not exists linkedin_action_queue_reprise_idx
  on linkedin_action_queue (reprise_le)
  where reprise_le is not null and status = 'failed';

do $$
begin
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.linkedin_action_queue'::regclass
       and attname = 'reprise_le' and not attisdropped
  ) then
    raise exception 'colonne linkedin_action_queue.reprise_le absente';
  end if;
  if to_regclass('public.linkedin_action_queue_reprise_idx') is null then
    raise exception 'index linkedin_action_queue_reprise_idx absent';
  end if;
end $$;

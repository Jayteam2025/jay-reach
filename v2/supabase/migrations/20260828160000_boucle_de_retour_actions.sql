-- ============================================================================
-- Refermer la boucle entre l'envoi et la mesure.
--
-- Le séquenceur émet une action, le dispatch l'envoie — et là, plus rien. Aucun
-- code ne fait jamais passer une action à `dispatched`, et la table `outcomes`
-- n'est écrite nulle part : elle était vide sur une base ayant pourtant servi
-- une journée entière de recette.
--
-- Toute la mesure en dépend, ce qui explique des écrans qui se contredisent :
-- le tableau de bord affichait « Réponses : 0 » en listant cinq réponses juste
-- en dessous, sa répartition par canal restait vide, et les statistiques de
-- campagne (`campaign_stats`, une vue qui compte les actions `dispatched` et
-- les `outcomes`) renvoyaient zéro partout.
--
-- Il manquait d'abord un lien : la file LinkedIn ne sait pas de quelle action
-- elle vient. Quand l'extension rapporte un envoi, il n'y avait donc aucun
-- moyen de retrouver l'action à marquer.
-- ============================================================================

alter table linkedin_action_queue
  add column if not exists action_id uuid references actions(id) on delete set null;

comment on column linkedin_action_queue.action_id is
  'Action du séquenceur à l''origine de cette ligne. Permet de refermer la boucle '
  'quand l''extension rapporte l''envoi. Nul pour une action mise en file à la main.';

-- Le rapport de l'extension retrouve sa ligne par l'id de file, puis l'action :
-- un index sur la colonne évite un parcours complet à chaque envoi confirmé.
create index if not exists linkedin_action_queue_action_idx
  on linkedin_action_queue (action_id) where action_id is not null;

-- Un envoi ne doit être compté qu'une fois, même si un rapport arrive deux fois
-- ou qu'un rejeu repasse par là. L'unicité est portée par la base plutôt que par
-- la prudence de chaque appelant.
create unique index if not exists outcomes_action_type_uidx
  on outcomes (action_id, type);

comment on index outcomes_action_type_uidx is
  'Un résultat d''un type donné ne peut être enregistré qu''une fois par action : '
  'deux rapports d''envoi ne doivent pas compter deux envois.';

-- ============================================================================
-- Marquer une action comme réellement partie.
--
-- Appelée depuis deux endroits — le worker après un push Smartlead réussi, et
-- l'application quand l'extension rapporte un envoi LinkedIn. Une fonction
-- plutôt que deux implémentations : ces deux chemins doivent produire
-- exactement le même état, sinon les statistiques dépendent du canal.
--
-- Idempotente : l'action ne repasse à `dispatched` que si elle ne l'est pas
-- déjà, et l'index unique sur (action_id, type) absorbe un second rapport.
-- ============================================================================
create or replace function app.mark_action_dispatched(p_action uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'app'
as $$
declare v_maj int;
begin
  if p_action is null then
    return false;
  end if;

  update actions
     set status = 'dispatched',
         dispatched_at = coalesce(dispatched_at, now())
   where id = p_action
     and status not in ('dispatched', 'delivered', 'cancelled');
  get diagnostics v_maj = row_count;

  -- L'enregistrement du résultat ne dépend pas de la mise à jour du statut :
  -- une action déjà marquée par un premier rapport doit quand même avoir son
  -- résultat, et un second rapport ne doit pas en créer un deuxième.
  insert into outcomes (action_id, type)
  values (p_action, 'sent')
    on conflict (action_id, type) do nothing;

  return v_maj > 0;
end $$;

comment on function app.mark_action_dispatched(uuid) is
  'Marque une action comme partie et enregistre son résultat `sent`. Idempotente : '
  'un second rapport d''envoi ne compte pas un second envoi.';

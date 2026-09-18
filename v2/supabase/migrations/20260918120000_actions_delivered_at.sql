-- « Partis » doit compter les messages RÉELLEMENT envoyés, pas ceux remis au
-- transporteur (F12, lot 2). SalesBlink envoie un email dans SA PROPRE fenêtre
-- horaire, après que Jay Reach le lui a remis (`actions.dispatched_at`) : les
-- deux instants peuvent être séparés de plusieurs heures. Le seul instant
-- réel de départ déjà connu vit dans `payload->>'delivered_at'` (posé par la
-- relève, `apps/worker/src/handlers/releve-salesblink.ts`) — en colonne, pas
-- en JSON, pour pouvoir compter et indexer proprement les envois du jour.
alter table actions add column if not exists delivered_at timestamptz;

-- Rétro-remplissage : les actions déjà relevées portent déjà l'instant dans
-- leur payload. Idempotent (filtré sur `delivered_at is null`) — rejouable
-- sans casse ni écriture inutile.
update actions
   set delivered_at = (payload ->> 'delivered_at')::timestamptz
 where delivered_at is null
   and payload ? 'delivered_at';

-- Sert les comptages « combien sont réellement partis aujourd'hui », filtrés
-- par organisation et par plage horaire (même motif que actions_org_status_idx) —
-- partiel : seules les actions déjà livrées ont cette colonne renseignée.
create index if not exists actions_org_delivered_idx on actions (organization_id, delivered_at)
  where delivered_at is not null;

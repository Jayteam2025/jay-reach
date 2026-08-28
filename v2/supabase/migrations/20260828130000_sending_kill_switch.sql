-- ============================================================================
-- Interrupteur d'arrêt global des envois (T18, garde-fou n° 9).
--
-- Quand quelque chose part de travers — un modèle mal relu, un import douteux,
-- un doute sur une liste — il faut pouvoir tout arrêter en un geste, sans
-- désactiver les sources une par une ni arrêter le worker.
--
-- Un horodatage plutôt qu'un booléen : savoir DEPUIS QUAND les envois sont
-- suspendus vaut mieux que savoir qu'ils le sont. C'est la première question
-- qu'on se pose en revenant sur une organisation à l'arrêt.
--
-- Le garde-fou est prioritaire sur tous les autres : `runGuards` le teste en
-- premier et bloque l'action, quel que soit le canal.
-- ============================================================================

alter table organizations add column if not exists sending_paused_at timestamptz;
alter table organizations add column if not exists sending_paused_reason text;

comment on column organizations.sending_paused_at is
  'Arrêt global des envois. Non nul = plus aucune action ne part, tous canaux confondus.';
comment on column organizations.sending_paused_reason is
  'Motif affiché à l''opérateur, pour qu''il sache pourquoi son organisation est à l''arrêt.';

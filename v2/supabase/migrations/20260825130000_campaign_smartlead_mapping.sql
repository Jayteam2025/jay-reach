-- ============================================================================
-- Mapping campagne v2 → campagne Smartlead (T20). Le canal email du séquenceur
-- pousse les leads vers une campagne Smartlead ; il faut donc savoir laquelle.
-- L'opérateur renseigne l'id de sa campagne Smartlead sur la campagne Jay Reach.
-- Sans mapping, l'étape email reste planifiée mais n'est pas dispatchée (pas
-- d'envoi silencieux vers la mauvaise campagne).
-- ============================================================================
alter table public.campaigns
  add column if not exists smartlead_campaign_id text;

comment on column public.campaigns.smartlead_campaign_id is
  'Id de la campagne Smartlead vers laquelle pousser les leads du canal email. Null = canal email non dispatché (à configurer).';

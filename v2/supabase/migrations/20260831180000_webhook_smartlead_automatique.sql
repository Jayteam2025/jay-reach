-- Le webhook Smartlead se branche tout seul (retour 6.1).
--
-- Jusqu'ici, un écran du menu principal affichait une URL et un jeton, et
-- demandait à l'opérateur d'aller les coller dans Smartlead, puis de cocher les
-- bons événements. C'est de la configuration technique : sans elle, aucune
-- réponse ne remonte, et rien dans l'application ne le signalait.
--
-- Le branchement se fait désormais côté serveur, au premier envoi passant par
-- une campagne Smartlead. C'est le moment naturel : la campagne existe, la clé
-- API est valide puisqu'on s'en sert, et l'appel de Smartlead est idempotent.
-- Cette colonne évite de le refaire à chaque envoi.
alter table smartlead_campaign_mappings
  add column if not exists webhook_registered_at timestamptz;

comment on column smartlead_campaign_mappings.webhook_registered_at is
  'Date du branchement automatique du webhook chez Smartlead. Nul = jamais branché.';

-- Retrait de Smartlead (lot 3, tache 8). A appliquer SEULEMENT apres le
-- deploiement du worker et du web de ce lot : ils sont les derniers a lire
-- encore public.smartlead_campaign_mappings, remplacee par le transport email
-- SalesBlink (email_transport_bindings, provider_sync_state).
drop table if exists public.smartlead_campaign_mappings cascade;

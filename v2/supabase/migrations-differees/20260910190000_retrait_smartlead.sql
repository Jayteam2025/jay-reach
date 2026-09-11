-- Retrait de Smartlead (lot 3, tache 8). Migration DIFFEREE (voir le README de
-- ce dossier) : a appliquer a la main SEULEMENT apres le deploiement du
-- worker et du web de ce lot (voir deploy/vps/README.md et le CHANGELOG pour
-- l'ordre complet) : ils sont les derniers a lire encore
-- public.smartlead_campaign_mappings, remplacee par le transport email
-- SalesBlink (email_transport_bindings, provider_sync_state).
--
-- Sauvegarde avant suppression (revue finale, I3) : une table qui n'existe
-- plus ne coute rien a garder de cote, et le mapping repris du socle v1 ne se
-- reconstruit pas a la main.
do $$
begin
  if to_regclass('public.smartlead_campaign_mappings') is not null then
    create table if not exists public.smartlead_campaign_mappings_sauvegarde_20260910 as
      select * from public.smartlead_campaign_mappings;
  end if;
end $$;

drop table if exists public.smartlead_campaign_mappings cascade;

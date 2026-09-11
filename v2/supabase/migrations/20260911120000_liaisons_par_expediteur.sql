-- Une sequence SalesBlink par etape ET par boite d'envoi (lot 3, correction
-- de revue finale, I2) : la cle precedente (organization_id, campaign_id,
-- step_id) laissait tous les expediteurs d'une meme etape partager la meme
-- sequence, donc la meme boite d'envoi chez SalesBlink. Additive seulement :
-- la table est vide sur toute base connue a ce jour, donc la colonne peut
-- passer obligatoire dans la foulee sans migration de donnees.

alter table public.email_transport_bindings
  add column if not exists sender_id uuid references public.senders(id) on delete cascade;

do $$
begin
  if not exists (select 1 from public.email_transport_bindings where sender_id is null) then
    alter table public.email_transport_bindings alter column sender_id set not null;
  end if;
end $$;

alter table public.email_transport_bindings drop constraint if exists email_transport_bindings_pkey;
alter table public.email_transport_bindings add primary key (organization_id, campaign_id, step_id, sender_id);

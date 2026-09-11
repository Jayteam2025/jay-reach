-- Une sequence SalesBlink par etape ET par boite d'envoi (lot 3, correction
-- de revue finale, I2) : la cle precedente (organization_id, campaign_id,
-- step_id) laissait tous les expediteurs d'une meme etape partager la meme
-- sequence, donc la meme boite d'envoi chez SalesBlink. Additive seulement :
-- `add primary key` impose deja `not null` sur `sender_id` et echoue
-- proprement si une ligne existante ne le porte pas.

alter table public.email_transport_bindings
  add column if not exists sender_id uuid references public.senders(id) on delete cascade;

alter table public.email_transport_bindings drop constraint if exists email_transport_bindings_pkey;
alter table public.email_transport_bindings add primary key (organization_id, campaign_id, step_id, sender_id);

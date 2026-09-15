-- Lecture directe des reponses (lot 3 bis) : une boite peut etre relevee
-- directement via Microsoft Graph, en plus (ou a la place) de la releve
-- SalesBlink existante. Additive seulement.

alter table public.senders add column if not exists inbox_provider text
  check (inbox_provider is null or inbox_provider in ('microsoft_graph'));
comment on column public.senders.inbox_provider is 'Lecture directe des reponses dans la boite (null = via le transport seulement)';

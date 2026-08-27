-- ============================================================================
-- Cache des réponses de providers payants (T10 — « cache anti-double-paiement »).
--
-- Le moteur d'enrichissement porté du socle actuel sait déjà se mettre en cache :
-- il interroge une table avant chaque appel FullEnrich facturé. Côté v2, ce cache
-- était branché sur un adaptateur inerte qui renvoyait toujours un miss, donc
-- chaque contact enrichi deux fois était payé deux fois.
--
-- POURQUOI `provider_cache` ET NON `enrichment_cache` : le socle actuel porte déjà
-- une table de ce nom, et jusqu'à la bascule les deux schémas cohabitent sur la
-- même base. La sienne n'a pas d'`organization_id` et impose une unicité globale
-- `(cache_type, cache_key)` — deux organisations ne pourraient pas mettre en cache
-- la même entreprise. Le nom retenu est aussi plus juste : le mécanisme n'a rien
-- de propre à l'enrichissement, il sert à tout provider facturé à l'appel.
--
-- Le cache est cloisonné PAR ORGANISATION (règle CLAUDE.md #5). Partager entre
-- organisations économiserait des crédits, mais reviendrait à laisser une
-- organisation apprendre ce qu'une autre a cherché.
-- ============================================================================

create table provider_cache (
  organization_id uuid not null references organizations(id) on delete cascade,
  cache_type text not null,
  cache_key text not null,
  data jsonb not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, cache_type, cache_key)
);

-- Purge des entrées périmées.
create index provider_cache_expiry_idx on provider_cache (expires_at);

alter table provider_cache enable row level security;
alter table provider_cache force row level security;

-- Aucune policy, volontairement : cette table est réservée au service_role, qui
-- contourne la RLS. Elle contient des réponses brutes de providers et n'a rien à
-- faire dans un navigateur, même pour un membre de l'organisation.

comment on table provider_cache is
  'Cache des réponses de providers facturés à l''appel (FullEnrich…), cloisonné par organisation. Réservé au service_role : aucune policy, jamais exposé au client.';

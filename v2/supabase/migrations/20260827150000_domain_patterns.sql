-- ============================================================================
-- Pattern d'adresse dominant par domaine (T10 / gate de délivrabilité).
--
-- Le gate `shouldPushToSmartlead` ne laisse passer un email `risky` — dont tous
-- les `CATCH_ALL`, très courants en entreprise — que si le pattern du domaine est
-- solide : tier `high` et confiance ≥ 0,85. Cette entrée était codée à `null`
-- dans le tick, donc la branche était morte et ces contacts étaient tous bloqués.
--
-- Le pattern se déduit des adresses déjà connues d'un domaine : voir trois fois
-- `prenom.nom@acme.fr` permet de juger la quatrième.
--
-- POURQUOI `domain_patterns` ET NON `domain_email_patterns` : le socle actuel porte
-- déjà ce nom, sans `organization_id` et avec une clé primaire sur le seul domaine.
-- Les deux schémas cohabitent jusqu'à la bascule.
--
-- Cloisonné par organisation (règle CLAUDE.md #5) : un pattern se déduit des
-- contacts d'une organisation, et sert à décider de ses envois à elle.
-- ============================================================================

create table domain_patterns (
  organization_id uuid not null references organizations(id) on delete cascade,
  domain text not null,
  pattern text not null,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  -- `low` n'est jamais produit par la détection, mais le gate l'accepte en
  -- entrée : on le tolère ici pour que la table puisse exprimer tout ce qu'il lit.
  tier text not null check (tier in ('high', 'medium', 'low', 'skip')),
  sample_count int not null default 0 check (sample_count >= 0),
  hits int not null default 0 check (hits >= 0),
  secondary_pattern text,
  secondary_hits int,

  -- Apprentissage empirique. Le gate lit ces trois colonnes : au-delà de 15 % de
  -- rebonds sur dix envois ou plus, il refuse le pattern même s'il est `high`, et
  -- `downgraded_at` le disqualifie d'office. Elles restent à zéro tant que les
  -- retours d'envoi ne les alimentent pas — le gate se comporte alors comme si
  -- aucun historique n'existait, ce qui est le cas.
  empirical_sends int not null default 0 check (empirical_sends >= 0),
  empirical_bounces int not null default 0 check (empirical_bounces >= 0),
  downgraded_at timestamptz,
  downgraded_reason text,

  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, domain)
);

-- Les seuls patterns que le gate peut retenir.
create index domain_patterns_usable_idx on domain_patterns (organization_id, domain)
  where tier in ('high', 'medium') and downgraded_at is null;

alter table domain_patterns enable row level security;
alter table domain_patterns force row level security;

-- Lecture pour les membres : comprendre pourquoi un contact n'est pas parti passe
-- par là. L'écriture reste au service_role, qui contourne la RLS — un pattern se
-- déduit de données observées, il ne se décrète pas depuis un navigateur.
create policy domain_patterns_read on public.domain_patterns
  for select to authenticated
  using (organization_id in (select app.user_orgs('viewer')));

comment on table domain_patterns is
  'Pattern d''adresse dominant par domaine, déduit des contacts déjà enrichis. Lu par le gate de délivrabilité pour décider d''un email non explicitement valide.';

-- Extraits réutilisables : un texte fixe, écrit une fois, inséré partout.
--
-- Trois des modèles importés réclamaient `{{signature}}`, et le moteur n'a
-- jamais eu de variable de signature — l'écran « Identité de marque » avait
-- d'ailleurs été retiré faute de savoir où la brancher. L'opérateur devait donc
-- retaper sa signature dans chaque message, et rouvrir les dix le jour où son
-- numéro change.
--
-- Ce n'est pas une variable de personnalisation : sa valeur ne dépend pas du
-- prospect. Mais elle se résout au même moment et par le même mécanisme, ce qui
-- évite d'inventer une seconde syntaxe pour l'opérateur — il écrit
-- `{{signature}}` comme il écrit `{{prenom}}`.
--
-- Résolu à l'ENVOI et non copié à la rédaction : c'est ce qui permet de changer
-- un numéro de téléphone une fois pour tous les messages déjà écrits.

create table if not exists message_snippets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Le nom EST la variable : `signature` s'écrit `{{signature}}`. Contraint à
  -- la même forme qu'une variable, sinon on pourrait déclarer un extrait
  -- impossible à appeler.
  name text not null check (name ~ '^[a-z][a-z0-9_]*$'),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un nom par organisation : deux extraits homonymes rendraient la résolution
-- arbitraire.
create unique index if not exists message_snippets_nom_unique_idx
  on message_snippets (organization_id, name);

create index if not exists message_snippets_org_idx
  on message_snippets (organization_id);

alter table message_snippets enable row level security;

-- Lecture pour les membres de l'organisation, écriture pour les administrateurs.
drop policy if exists message_snippets_lecture on message_snippets;
create policy message_snippets_lecture on message_snippets
  for select using (
    exists (select 1 from memberships m
             where m.organization_id = message_snippets.organization_id
               and m.user_id = auth.uid())
  );

drop policy if exists message_snippets_ecriture on message_snippets;
create policy message_snippets_ecriture on message_snippets
  for all using (
    exists (select 1 from memberships m
             where m.organization_id = message_snippets.organization_id
               and m.user_id = auth.uid()
               and m.role in ('owner', 'admin'))
  );

comment on table message_snippets is
  'Textes fixes reutilisables dans les messages (signature, mentions). Resolus a l''envoi comme une variable, mais leur valeur vient de l''organisation et non du prospect.';

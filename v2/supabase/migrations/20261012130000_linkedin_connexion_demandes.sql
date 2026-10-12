-- ============================================================================
-- Lot 5, tâche 2 : l'ÉTAT d'une tentative de connexion LinkedIn depuis l'app.
--
-- Cette table ne porte JAMAIS un secret : ni identifiant, ni mot de passe, ni code
-- de vérification (ils passent par un autre canal, chiffrés). `etape` est une
-- phrase d'avancement écrite par le serveur, issue d'une liste fermée ; `motif`
-- est une valeur d'une liste fermée, jamais le texte d'une exception.
--
-- L'index unique partiel garantit UNE demande en cours par organisation : deux
-- onglets ne peuvent pas lancer deux connexions concurrentes sur le même navigateur.
-- Additive : une nouvelle table, rien d'existant n'est touché.
-- ============================================================================

create table if not exists public.linkedin_connexion_demandes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  demandee_par uuid not null references auth.users(id),
  statut text not null check (statut in
    ('demandee', 'navigateur_ouvert', 'code_demande', 'reussi', 'echec')),
  motif text check (motif in
    ('sortie_inattendue', 'sortie_serveur', 'verrou_occupe', 'refuse', 'defi',
     'delai', 'worker_absent', 'trop_essais', 'annulee')),
  etape text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create unique index if not exists linkedin_connexion_une_seule_en_cours
  on public.linkedin_connexion_demandes (organization_id)
  where statut in ('demandee', 'navigateur_ouvert', 'code_demande');

alter table public.linkedin_connexion_demandes enable row level security;

-- Lecture : tous les membres de l'organisation.
drop policy if exists linkedin_connexion_lecture on public.linkedin_connexion_demandes;
create policy linkedin_connexion_lecture on public.linkedin_connexion_demandes for select
  using (organization_id in (select organization_id from public.memberships where user_id = auth.uid()));

-- Écriture : `admin` et `owner` uniquement, et une demande est toujours au nom de
-- celui qui la pose.
drop policy if exists linkedin_connexion_insertion on public.linkedin_connexion_demandes;
create policy linkedin_connexion_insertion on public.linkedin_connexion_demandes for insert
  with check (
    demandee_par = auth.uid()
    and organization_id in (select organization_id from public.memberships
                            where user_id = auth.uid() and role in ('admin', 'owner'))
  );

drop policy if exists linkedin_connexion_modification on public.linkedin_connexion_demandes;
create policy linkedin_connexion_modification on public.linkedin_connexion_demandes for update
  using (organization_id in (select organization_id from public.memberships
                             where user_id = auth.uid() and role in ('admin', 'owner')))
  with check (organization_id in (select organization_id from public.memberships
                                  where user_id = auth.uid() and role in ('admin', 'owner')));

drop policy if exists linkedin_connexion_suppression on public.linkedin_connexion_demandes;
create policy linkedin_connexion_suppression on public.linkedin_connexion_demandes for delete
  using (organization_id in (select organization_id from public.memberships
                             where user_id = auth.uid() and role in ('admin', 'owner')));

-- Purge, appelée par le worker (service_role) : une demande restée en cours après
-- son échéance passe en échec `delai` (sinon l'index unique bloquerait toute
-- nouvelle demande), puis les demandes terminées depuis plus de 24 h sont
-- supprimées. La trace durable est dans le journal d'audit. Renvoie le nombre de
-- lignes supprimées.
create or replace function public.purger_linkedin_connexion_demandes()
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  n integer;
begin
  update public.linkedin_connexion_demandes
     set statut = 'echec', motif = 'delai', etape = null, updated_at = now()
   where statut in ('demandee', 'navigateur_ouvert', 'code_demande')
     and expires_at < now();

  delete from public.linkedin_connexion_demandes
   where statut in ('reussi', 'echec')
     and updated_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- EXECUTE est accordé à PUBLIC par défaut : on le retire de tous, puis on le rend
-- au seul service_role.
revoke execute on function public.purger_linkedin_connexion_demandes() from public, anon, authenticated;
grant execute on function public.purger_linkedin_connexion_demandes() to service_role;

-- La migration se vérifie elle-même.
do $$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'linkedin_connexion_une_seule_en_cours') then
    raise exception 'linkedin_connexion_demandes : index unique partiel absent';
  end if;
  if has_function_privilege('anon', 'public.purger_linkedin_connexion_demandes()', 'execute')
     or has_function_privilege('authenticated', 'public.purger_linkedin_connexion_demandes()', 'execute') then
    raise exception 'purger_linkedin_connexion_demandes : EXECUTE ouvert à anon ou authenticated';
  end if;
end $$;

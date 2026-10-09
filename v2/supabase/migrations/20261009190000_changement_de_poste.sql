-- ============================================================================
-- Source « changement de poste ».
--
-- Sans Sales Navigator, LinkedIn n'offre aucun filtre « a changé de poste » :
-- la seule voie est de RELIRE les profils qu'on connaît déjà et de comparer
-- l'intitulé. Cette source ne découvre donc personne — elle réveille ceux qu'on
-- a déjà, ce qui reste un signal de prospection reconnu (quelqu'un qui n'était
-- pas pertinent à son ancien poste peut l'être au nouveau).
--
-- Deux objets, et rien d'autre :
--  - le kind `job_change`, qui rejoint la famille des signaux de personne ;
--  - `contacts.linkedin_verifie_le`, qui porte la ROTATION : on relit du plus
--    anciennement vérifié au plus récent, pour qu'un plafond de requêtes serré
--    finisse quand même par passer sur tout le monde. Sans cette colonne, un
--    `order by` arbitraire relirait les mêmes profils tous les jours et
--    n'atteindrait jamais les derniers.
--
-- `alter type ... add value` ne peut pas être suivi d'un USAGE de la valeur dans
-- la même transaction : ce fichier ne fait que l'ajouter.
-- ============================================================================

alter type signal_kind add value if not exists 'job_change';

alter table public.contacts
  add column if not exists linkedin_verifie_le timestamptz;

comment on column public.contacts.linkedin_verifie_le is
  'Dernière relecture de la page LinkedIn de ce contact (source « changement de poste »). Nul = jamais relu, donc prioritaire.';

-- Partiel : seuls les contacts à adresse LinkedIn sont relus, et `nulls first`
-- met les jamais-vérifiés en tête, exactement dans l'ordre que lit le collecteur.
create index if not exists contacts_linkedin_a_verifier_idx
  on public.contacts (organization_id, linkedin_verifie_le nulls first)
  where linkedin_url is not null;

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'signal_kind' and e.enumlabel = 'job_change') then
    raise exception 'signal_kind ne porte pas la valeur job_change';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'contacts' and column_name = 'linkedin_verifie_le') then
    raise exception 'contacts.linkedin_verifie_le absent';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'contacts_linkedin_a_verifier_idx') then
    raise exception 'contacts_linkedin_a_verifier_idx absent';
  end if;
end $$;

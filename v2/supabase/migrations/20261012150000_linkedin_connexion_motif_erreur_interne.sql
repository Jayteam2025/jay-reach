-- Lot 5, tâche 5 : un motif de repli pour la connexion LinkedIn depuis l'app.
-- Une exception autre qu'un délai (navigateur qui plante, base qui tombe) laissait la demande
-- « en cours » sans motif jusqu'à son expiration, soit un quart d'heure d'écran figé. Le worker
-- la clôt désormais en `echec / erreur_interne` : la liste fermée gagne cette valeur, qui ne dit
-- rien de l'exception (jamais son texte, il pourrait porter un secret).
-- Additive : on élargit une contrainte, aucune ligne existante n'est touchée.

alter table public.linkedin_connexion_demandes
  drop constraint if exists linkedin_connexion_demandes_motif_check;

alter table public.linkedin_connexion_demandes
  add constraint linkedin_connexion_demandes_motif_check check (motif is null or motif in
    ('sortie_inattendue', 'sortie_serveur', 'verrou_occupe', 'refuse', 'defi',
     'delai', 'worker_absent', 'trop_essais', 'annulee', 'erreur_interne'));

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.linkedin_connexion_demandes'::regclass
                    and conname = 'linkedin_connexion_demandes_motif_check'
                    and pg_get_constraintdef(oid) like '%erreur_interne%') then
    raise exception 'linkedin_connexion_demandes : le motif erreur_interne n''est pas accepté';
  end if;
end $$;

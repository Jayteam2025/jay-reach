-- ============================================================================
-- Déclenchement d'une collecte à la demande.
--
-- Les sources sont planifiées, mais une recette a besoin de déclencher tout de
-- suite : attendre le prochain cycle du producteur (quinze minutes) rend toute
-- vérification pénible, et un opérateur qui vient de corriger ses mots-clés veut
-- voir le résultat.
--
-- On passe par une demande posée en base plutôt que par une insertion directe
-- dans la file : l'application web ne connaît pas pg-boss, et lui ajouter cette
-- dépendance pour un bouton reviendrait à dupliquer la moitié du worker. Le
-- worker relève les demandes dans une boucle légère — un simple SELECT — et les
-- transforme en jobs comme il le fait pour les sources planifiées.
--
-- `run_requested_at` est remis à NULL par le worker dès qu'il a enfilé le job :
-- la colonne porte « une collecte est demandée », pas un historique. L'historique
-- vit dans `source_runs`.
-- ============================================================================

alter table sources add column if not exists run_requested_at timestamptz;

-- Les demandes en attente sont rares : un index partiel suffit, et il reste
-- minuscule même avec beaucoup de sources.
create index if not exists sources_run_requested_idx on sources (run_requested_at)
  where run_requested_at is not null;

comment on column sources.run_requested_at is
  'Horodatage d''une collecte demandée à la main. Remis à NULL par le worker une fois le job enfilé.';

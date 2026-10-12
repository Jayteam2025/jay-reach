-- Lot 5, tâche 2 (correctif) : `etape` devient une liste fermée, comme `statut` et `motif`.
-- La migration précédente l'annonçait sans la contraindre : un `text` libre pouvait
-- recevoir n'importe quelle chaîne, donc un secret. Les cinq étapes sont celles que le
-- worker écrit pendant une connexion et que l'écran affiche ; null = pas encore d'étape.
-- Additive : la table est neuve et ne contient aucune ligne à ce stade.

alter table public.linkedin_connexion_demandes
  add constraint linkedin_connexion_etape_liste_fermee check (etape is null or etape in
    ('sortie_controlee', 'navigateur_ouvert', 'identifiants_transmis', 'code_demande', 'session_active'));

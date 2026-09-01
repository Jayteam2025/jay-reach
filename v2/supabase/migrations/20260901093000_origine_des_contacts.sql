-- Rattrapage : rendre aux contacts le signal qui les a fait naître.
--
-- Les 102 contacts de la base portaient tous `source_signal_id` à NULL. La
-- colonne existait et l'insertion la remplissait, mais la valeur n'arrivait
-- jamais : le producteur d'enrichissement partait bien des signaux qualifiés,
-- et son `select distinct` sur (compte, persona) jetait l'identifiant du
-- signal avant de composer le job. Personne ne pouvait donc dire quelle offre
-- avait motivé quelle prise de contact.
--
-- Ce rattrapage RECONSTRUIT ce lien, il ne le retrouve pas : on applique la
-- règle que le producteur applique désormais — le signal qualifié le plus
-- récent du compte. Pour un compte qui n'en a qu'un, c'est exact. Pour un
-- compte qui en a plusieurs, c'est le choix le plus plausible, pas une
-- certitude historique. Les contacts sans compte rattaché restent sans
-- origine : les rattacher au hasard vaudrait moins que rien.

-- Sous-requête corrélée plutôt qu'un FROM LATERAL : la clause FROM d'un UPDATE
-- ne peut pas référencer la table mise à jour.
update contacts c
   set source_signal_id = (
     select sig.id
       from signals sig
      where sig.account_id = c.account_id
        and sig.organization_id = c.organization_id
        and sig.status = 'qualified'
      order by sig.occurred_at desc, sig.id
      limit 1
   )
 where c.source_signal_id is null
   and c.account_id is not null;

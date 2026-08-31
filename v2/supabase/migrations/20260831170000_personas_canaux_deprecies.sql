-- Le canal se choisit au niveau de la campagne, étape par étape — ce que le
-- séquenceur sait déjà faire. `personas.channels_priority` n'était lue par
-- aucun moteur : ni le scoring, ni le séquenceur, ni l'envoi. Le champ
-- disparaît de l'interface (retour 5.1).
--
-- La colonne est marquée dépréciée plutôt que supprimée : une migration déjà
-- appliquée (la reprise des données du socle v1) y écrit, et la retirer ferait
-- échouer l'initialisation d'une base neuve. Elle partira quand cette reprise
-- sera elle-même retirée.
comment on column personas.channels_priority is
  'Déprécié (2026-08-31) : le canal se choisit sur l''étape de séquence, pas sur le persona. Plus lue par aucun code applicatif.';

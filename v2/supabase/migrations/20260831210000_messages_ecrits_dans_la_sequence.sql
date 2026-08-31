-- Écrire un message depuis l'étape de campagne (retours 9.1 et 9.3).
--
-- La modale d'étape ne savait que RELIER un message écrit ailleurs, d'où son
-- « Aucun message relié » et son lien vers la bibliothèque. C'est ce qui rendait
-- la page Messages incompréhensible : elle n'existait que parce que la séquence
-- ne savait pas écrire.
--
-- Un message écrit dans une étape reste un `message_templates` — c'est lui qui
-- porte le versionnage, la résolution des variables et la validation, et une
-- seconde façon de stocker un corps aurait dupliqué tout ça. Ce qui change,
-- c'est qu'il n'apparaît pas dans la bibliothèque tant que personne ne l'y a
-- versé : sinon toute écriture polluerait une liste censée contenir des modèles
-- qu'on réutilise.
alter table message_templates
  add column if not exists origin text not null default 'library'
  check (origin in ('library', 'step'));

comment on column message_templates.origin is
  'library = modèle de la bibliothèque, réutilisable. step = message écrit dans une étape de campagne, invisible dans la bibliothèque jusqu''à ce qu''on l''y verse.';

-- La bibliothèque filtre là-dessus à chaque affichage.
create index if not exists message_templates_origin_idx
  on message_templates (organization_id, origin);

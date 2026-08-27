-- ============================================================================
-- Deux verdicts manquants sur `email_status` : `disposable` et `role`.
--
-- Le gate de délivrabilité (`shouldPushToSmartlead`, porté du socle) distingue six
-- verdicts et refuse séparément une adresse jetable et une adresse générique
-- (contact@, info@). L'enum du v2 n'en portait que quatre, donc ces deux branches
-- du gate ne pouvaient jamais se déclencher : il aurait fallu ranger ces adresses
-- sous `invalid`, ce qui donne le bon refus mais perd la raison — et la raison est
-- ce qui permet de comprendre, six mois plus tard, pourquoi un contact n'est
-- jamais parti.
--
-- `add value if not exists` : rejouable. Les valeurs ajoutées ici ne sont pas
-- utilisables dans cette même transaction, elles ne le sont que par le code.
-- ============================================================================

alter type email_status add value if not exists 'disposable';
alter type email_status add value if not exists 'role';

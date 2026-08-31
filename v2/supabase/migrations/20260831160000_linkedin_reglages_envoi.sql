-- Réglages d'envoi LinkedIn : de vrais paramètres, plus un seul curseur.
--
-- Un volume par jour ne dit pas quand les messages partent. Un envoi le
-- dimanche à 3 h du matin est autant un signal d'automatisation qu'un volume
-- trop élevé, et c'est ce que le compte risque de payer. L'opérateur règle donc
-- le rythme (par semaine), les jours, la plage horaire et le fuseau.
--
-- Le délai aléatoire entre deux actions reste interne : il protège le compte,
-- et l'exposer inviterait à le réduire.

-- Rythme hebdomadaire. Le plafond dur reste 200 par semaine côté code.
alter table linkedin_settings add column if not exists weekly_cap int not null default 100
  check (weekly_cap between 0 and 200);

-- Jours d'envoi, 1 = lundi ... 7 = dimanche (ISO 8601, comme `extract(isodow)`).
alter table linkedin_settings add column if not exists send_days int[] not null default '{1,2,3,4,5}';

-- Plage horaire locale, bornes en heures pleines.
alter table linkedin_settings add column if not exists send_from_hour int not null default 9
  check (send_from_hour between 0 and 23);
alter table linkedin_settings add column if not exists send_to_hour int not null default 18
  check (send_to_hour between 1 and 24);

-- Le fuseau décide de ce que « 9 h » veut dire. Sans lui, un opérateur à
-- Bruxelles et un autre à Montréal auraient la même plage sur le papier et deux
-- comportements différents.
alter table linkedin_settings add column if not exists timezone text not null default 'Europe/Paris';

-- Une plage qui se termine avant de commencer n'enverrait jamais rien.
alter table linkedin_settings drop constraint if exists linkedin_settings_plage_coherente;
alter table linkedin_settings add constraint linkedin_settings_plage_coherente
  check (send_to_hour > send_from_hour);

-- Mode : seul « auto » subsiste. Les deux autres n'ont jamais été implémentés
-- côté extension — les proposer laissait choisir un comportement qui n'existe
-- pas. La contrainte est resserrée après avoir ramené les lignes existantes.
update linkedin_settings set mode = 'auto' where mode <> 'auto';
alter table linkedin_settings drop constraint if exists linkedin_settings_mode_check;
alter table linkedin_settings add constraint linkedin_settings_mode_check check (mode = 'auto');

comment on column linkedin_settings.mode is
  'Déprécié : seul « auto » existe. Conservé pour ne pas casser les lectures en place.';

-- Profil LinkedIn connecté, remonté par l'extension. Sert à afficher « connecté
-- à tel compte » plutôt qu'un simple « connecté » : sur un poste où plusieurs
-- sessions LinkedIn se succèdent, savoir laquelle enverra est le seul moyen
-- d'éviter d'envoyer depuis le mauvais compte.
alter table extension_tokens add column if not exists linkedin_profile_name text;
alter table extension_tokens add column if not exists linkedin_profile_identifier text;
alter table extension_tokens add column if not exists linkedin_seen_at timestamptz;

-- Lot 4b : savoir QUEL compte LinkedIn est ouvert sur le serveur.
--
-- `linkedin_server_sessions` dit l'état de la session, l'IP de sortie, l'opérateur réseau et le
-- pays — mais jamais l'identité du compte. Mesuré en recette le 08/10 : impossible de répondre à
-- « est-ce que le destinataire est en relation avec le compte qui envoie ? » autrement qu'en
-- demandant à l'opérateur ce qu'il avait tapé la veille. Or un message LinkedIn n'atteint qu'une
-- relation de 1er degré : sans cette réponse, on ne sait pas si un envoi va aboutir ou être
-- refusé définitivement.
--
-- Les deux colonnes se remplissent sans aucune requête supplémentaire vers LinkedIn : l'appel
-- `/me` que l'envoi fait DÉJÀ (une fois par session de navigateur, pour connaître la boîte
-- d'envoi) porte l'identifiant public à côté de l'URN, et il était jeté.
--
-- Additive et idempotente, aucune valeur par défaut : une session déjà ouverte garde ses colonnes
-- nulles jusqu'au prochain envoi, et l'écran le dit plutôt que d'inventer un nom.

alter table linkedin_server_sessions
  add column if not exists account_public_id text,
  add column if not exists account_urn text,
  add column if not exists account_seen_at timestamptz;

comment on column linkedin_server_sessions.account_public_id is
  'Identifiant public du compte connecté (le slug de /in/<slug>), lu dans la réponse /me de Voyager.';
comment on column linkedin_server_sessions.account_urn is
  'URN du profil du compte connecté (urn:li:fsd_profile:...), la boîte depuis laquelle les messages partent.';
comment on column linkedin_server_sessions.account_seen_at is
  'Quand cette identité a été lue pour la dernière fois. Nulle tant qu''aucun envoi n''a eu lieu depuis la connexion.';

do $$
declare
  v_manquantes text;
begin
  select string_agg(c, ', ') into v_manquantes
    from unnest(array['account_public_id', 'account_urn', 'account_seen_at']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'linkedin_server_sessions' and column_name = c
   );
  if v_manquantes is not null then
    raise exception 'linkedin_server_sessions : colonne(s) manquante(s) apres migration : %', v_manquantes;
  end if;
end $$;

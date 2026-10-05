-- Supprime la surcharge à sept arguments de `save_message_template_version`,
-- restée en place par accident et qui rend ambigu l'appel qu'elle devait préserver.
--
-- CE QUI S'EST PASSÉ. `20260831220000_version_message_transactionnelle.sql` ajoute
-- un paramètre `p_origin text default 'library'` et annonce en commentaire : « les
-- appels existants ne changent pas ». C'est l'inverse qui s'est produit. Un
-- `create or replace function` ne remplace que la fonction DE MÊME SIGNATURE :
-- passer de sept à huit paramètres en crée une SECONDE. Les deux coexistent
-- depuis, et comme le huitième porte une valeur par défaut, tout appel à sept
-- arguments correspond aux deux et Postgres refuse de choisir :
--
--   function app.save_message_template_version(unknown, unknown, …) is not unique
--
-- Relevé le 05/10 par `test/pg-verify/templates.sh`, et confirmé sur la base OSS :
-- les deux signatures y sont. Le code v2 n'appelle plus cette RPC (il versionne
-- par `packages/core/src/fonctions/sequence.ts`), donc rien ne cassait à l'écran —
-- mais toute instance restée sur l'appel à sept arguments, elle, prend l'erreur.
--
-- CE QU'ON SUPPRIME. Seulement la signature à sept paramètres, dans `app` et dans
-- `public`. La version à huit la couvre exactement : son `p_origin` vaut
-- « library » par défaut, c'est-à-dire le comportement qu'avait l'ancienne. Un
-- appel à sept arguments retrouve donc son sens d'origine, sans ambiguïté — c'est
-- la promesse du 31/08, tenue avec deux mois de retard.
drop function if exists app.save_message_template_version(uuid, uuid, text, channel_kind, text, text, text);
drop function if exists public.save_message_template_version(uuid, uuid, text, channel_kind, text, text, text);

-- Contrôle : une seule signature doit subsister de chaque côté, sans quoi
-- l'ambiguïté est toujours là et la migration doit échouer plutôt que de le taire.
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where p.proname = 'save_message_template_version' and s.nspname in ('app', 'public');
  if n <> 2 then
    raise exception 'save_message_template_version : % signatures au lieu de 2 (une par schéma)', n;
  end if;
end $$;

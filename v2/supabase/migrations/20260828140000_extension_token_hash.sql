-- ============================================================================
-- Le jeton d'extension ne doit plus vivre en clair en base.
--
-- Il etait stocke tel quel, avec une policy de lecture ouverte a tout membre
-- viewer : n'importe qui dans l'organisation pouvait donc lire un jeton qui
-- donne acces a l'API d'extension, et s'en servir depuis n'importe ou. C'est
-- exactement ce que la regle « aucun secret en clair en base » interdit.
--
-- On stocke desormais son empreinte SHA-256. La valeur en clair n'existe qu'une
-- fois, au moment ou l'ecran la remet a l'extension ; la base ne peut plus la
-- redonner a personne.
--
-- Les jetons deja emis continuent de fonctionner : on hache la valeur existante
-- sur place, donc l'extension qui detient le clair valide toujours. Personne
-- n'a a se reconnecter.
-- ============================================================================

-- La colonne porte un hash : la nommer `token` induirait en erreur le prochain
-- qui la lit.
alter table extension_tokens rename column token to token_hash;

update extension_tokens
   set token_hash = encode(extensions.digest(token_hash, 'sha256'), 'hex')
 where length(token_hash) <> 64 or token_hash !~ '^[0-9a-f]+$';

comment on column extension_tokens.token_hash is
  'Empreinte SHA-256 du jeton (hex). Le jeton en clair n''est jamais stocke.';

-- Compare l'empreinte, jamais la valeur. `p_token` reste le jeton en clair
-- envoye par l'extension : c'est la fonction qui le hache pour comparer.
create or replace function app.validate_extension_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions'
as $$
declare v_org uuid;
begin
  update extension_tokens set last_used_at = now()
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and is_active = true
    returning organization_id into v_org;
  return v_org;
end $$;

-- Un hash n'est pas exploitable tel quel, mais rien ne justifie de l'exposer :
-- la lecture de cette table revient aux administrateurs, qui sont deja les
-- seuls a pouvoir emettre un jeton.
drop policy if exists extension_tokens_read on extension_tokens;
create policy extension_tokens_read on extension_tokens
  for select using (organization_id in (select app.user_orgs('admin')));

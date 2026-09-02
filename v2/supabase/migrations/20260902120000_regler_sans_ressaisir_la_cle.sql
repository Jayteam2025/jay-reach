-- Modifier un réglage sans ressaisir la clé du fournisseur.
--
-- `set_credential` écrasait toujours le secret. Comme une clé n'est jamais
-- relisible — seuls ses quatre derniers caractères reviennent à l'écran —
-- changer un simple plafond quotidien obligeait à retrouver la clé d'API et à
-- la retaper. Le champ étant par ailleurs marqué obligatoire, le formulaire
-- refusait purement et simplement de partir : Alexandre a cliqué « Enregistrer »
-- sans que rien ne se passe ni qu'aucun message ne l'explique.
--
-- Un secret vide signifie désormais « ne touche pas à la clé ». Il ne peut pas
-- vouloir dire « efface la clé » : on n'efface pas un secret par omission, et
-- la seule façon de le retirer reste de supprimer la ligne.
create or replace function app.set_credential(
  p_org uuid, p_provider text, p_secret text, p_key text, p_config jsonb default '{}'::jsonb
) returns text
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions'
as $function$
declare
  v_last4 text;
  v_existant bytea;
  v_last4_existant text;
begin
  if coalesce(p_key, '') = '' then
    raise exception 'clé de chiffrement manquante';
  end if;

  select secret, last4 into v_existant, v_last4_existant
    from credentials
   where organization_id = p_org and provider_id = p_provider;

  -- Secret vide sur une ligne existante : on ne réécrit que la configuration.
  if coalesce(p_secret, '') = '' and v_existant is not null then
    update credentials
       set config = coalesce(p_config, '{}'), updated_at = now()
     where organization_id = p_org and provider_id = p_provider;
    return v_last4_existant;
  end if;

  if coalesce(p_secret, '') = '' then
    raise exception 'clé manquante pour un fournisseur pas encore configuré';
  end if;

  v_last4 := right(p_secret, 4);
  insert into credentials (organization_id, provider_id, secret, config, status, last4, updated_at)
    values (p_org, p_provider, pgp_sym_encrypt(p_secret, p_key), coalesce(p_config, '{}'),
            'configured', v_last4, now())
  on conflict (organization_id, provider_id) do update
    set secret = excluded.secret, config = excluded.config, status = 'configured',
        last4 = excluded.last4, updated_at = now();
  return v_last4;
end $function$;

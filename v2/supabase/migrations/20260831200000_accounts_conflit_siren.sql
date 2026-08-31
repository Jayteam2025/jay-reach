-- L'ajout d'une entreprise depuis l'annuaire ne créait rien.
--
-- `accounts_org_siren_uidx` est un index unique PARTIEL (`where siren is not
-- null`). Postgres refuse de l'inférer depuis un `on conflict (organization_id,
-- siren)` sans que le prédicat soit répété — « there is no unique or exclusion
-- constraint matching the ON CONFLICT specification ». PostgREST, lui, ne sait
-- pas exprimer ce prédicat : l'upsert de l'écran Annuaire échouait donc à
-- chaque clic, sans que rien ne s'affiche.
--
-- Le prédicat n'apportait rien : Postgres ne considère jamais deux NULL comme
-- égaux, donc un index unique ordinaire laisse déjà passer autant de comptes
-- sans SIREN qu'on veut. On le retire, et l'inférence redevient possible
-- partout — y compris depuis PostgREST.
create unique index if not exists accounts_org_siren_key
  on accounts (organization_id, siren);

drop index if exists accounts_org_siren_uidx;

-- Même raisonnement pour le domaine, utilisé par l'import de fichiers.
create unique index if not exists accounts_org_domain_key
  on accounts (organization_id, domain);

drop index if exists accounts_org_domain_uidx;

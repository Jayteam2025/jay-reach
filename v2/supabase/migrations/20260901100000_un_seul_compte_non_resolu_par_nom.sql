-- Un employeur non résolu n'existe qu'une fois.
--
-- La branche « entreprise non résolue » de `upsertResolvedAccount` insérait
-- sans rien chercher : chaque offre d'un employeur que l'annuaire légal ne
-- reconnaît pas créait son propre compte. 404 comptes en trop sur 1 572, dont
-- soixante-deux pour un seul employeur, et sept de plus apparus en une heure.
--
-- Le code cherche désormais avant d'insérer, mais deux collectes simultanées
-- pourraient encore passer entre les deux. Cet index tranche la course : la
-- seconde insertion rejoint le compte existant au lieu d'en créer un second.
--
-- Partiel sur `siren is null` à dessein : deux établissements d'un même groupe
-- portent légitimement le même nom dès lors qu'ils ont des SIREN distincts.
-- C'est l'absence d'identité légale qui rend le nom seul discriminant.
--
-- Cet index ne peut être posé qu'après fusion des doublons existants — faite le
-- 01/09/2026, les comptes supprimés étant conservés dans
-- `accounts_doublons_archive_20260901`.
create unique index if not exists accounts_nom_unique_si_non_resolu_idx
  on accounts (organization_id, lower(name))
  where siren is null;

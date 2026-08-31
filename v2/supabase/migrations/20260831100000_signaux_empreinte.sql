-- Déduplication des signaux par empreinte (docs/03-sources.md §34).
--
-- L'unicité existante porte sur (source_id, external_id) : elle empêche
-- d'enregistrer deux fois la même annonce vue par la même source. Elle ne voit
-- rien quand la même offre est publiée sur plusieurs agrégateurs — cas courant,
-- puisqu'un employeur diffuse simultanément sur France Travail et sur les
-- agrégateurs qu'Adzuna indexe. Chaque copie repart alors en scoring, en
-- enrichissement, et peut faire contacter deux fois la même entreprise.
--
-- L'empreinte (entreprise + intitulé + code postal, normalisés) est calculée
-- côté applicatif, avec la même fonction que celle couverte par les tests.
-- La calculer en SQL dupliquerait la normalisation, et les deux finiraient par
-- diverger sur les accents ou la ponctuation.
alter table signals add column if not exists fingerprint text;

comment on column signals.fingerprint is
  'Empreinte de déduplication inter-sources (signalFingerprint). Fenêtre de 30 jours glissants.';

-- Index de la vérification faite à chaque insertion : filtre par organisation
-- et empreinte, borné dans le temps.
create index if not exists signals_fingerprint_idx
  on signals (organization_id, fingerprint, occurred_at desc)
  where fingerprint is not null;

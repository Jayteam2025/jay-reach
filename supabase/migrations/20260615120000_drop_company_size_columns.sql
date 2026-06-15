-- PR5 dé-hardcoding : suppression du sélecteur de taille d'entreprise sur les
-- triggers. company_size_min/max étaient stockés mais IGNORÉS au scraping (jamais
-- appliqués au filtrage). On retire le champ mort (back+front) et ses colonnes.
-- NB : prospect_profiles.company_size (effectif enrichi affiché) n'est PAS concerné.
ALTER TABLE public.signal_triggers
  DROP COLUMN IF EXISTS company_size_min,
  DROP COLUMN IF EXISTS company_size_max;

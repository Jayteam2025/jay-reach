-- =============================================================================
-- Config de recherche par persona (search_strategy / enrichment_caps) + blacklist
-- =============================================================================
-- jay-reach avait raté la migration de-hardcoding PR1 du source (20260604120000).
-- Conséquence : icp_personas.search_strategy absente -> enrich-company échoue
-- ("search_strategy inconnue undefined") pour TOUT persona. On porte ici le SCHÉMA
-- (colonnes + défauts, qui backfillent les personas existants) + le seed de la
-- blacklist des cabinets/intérim. Les UPDATE Jay-spécifiques du source (3 personas
-- par slug Jay + workspace 000...001) sont volontairement OMISES.
-- =============================================================================

ALTER TABLE public.icp_personas
  ADD COLUMN IF NOT EXISTS search_strategy TEXT NOT NULL DEFAULT 'by_titles'
    CHECK (search_strategy IN ('by_titles', 'seniority_cast_wide'));

ALTER TABLE public.icp_personas
  ADD COLUMN IF NOT EXISTS enrichment_caps JSONB NOT NULL DEFAULT
    '{"search_max": 15, "keep_cap": 5, "min_contacts": 1}'::jsonb;

ALTER TABLE public.signal_triggers
  ADD COLUMN IF NOT EXISTS exclude_intermediaries BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.icp_personas.search_strategy IS
  'Stratégie FullEnrich : by_titles = recherche par job_title_keywords ; seniority_cast_wide = recherche large par seniority_levels seuls puis filtre IA.';
COMMENT ON COLUMN public.icp_personas.enrichment_caps IS
  '{search_max, keep_cap|null, min_contacts} — caps de la recherche de contacts pour ce persona.';
COMMENT ON COLUMN public.signal_triggers.exclude_intermediaries IS
  'Si TRUE (défaut), les cabinets/intermédiaires (recruitment_agencies_blacklist) sont exclus du pipeline pour ce trigger.';

-- scoring_axes : jamais lu par le pipeline (le scoring passe par les prompts).
ALTER TABLE public.icp_personas DROP COLUMN IF EXISTS scoring_axes;

-- ---------------------------------------------------------------------------
-- Seed de la blacklist cabinets / intérim (générique, pas Jay-specific).
-- Renforce l'exclusion au scrape (signal-processor lit cette table).
-- Idempotent + déduplifié via normalize_agency_name + ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------
INSERT INTO public.recruitment_agencies_blacklist (name_normalized, name_display, source)
SELECT DISTINCT ON (public.normalize_agency_name(x.name))
  public.normalize_agency_name(x.name), x.name, 'seed_hardcoded'
FROM (VALUES
  ('Adecco'), ('Manpower'), ('Randstad'), ('Hays'), ('Michael Page'), ('Page Personnel'),
  ('Robert Half'), ('Spring'), ('Expectra'), ('Synergie'), ('Crit'), ('Actual'), ('Temporis'),
  ('Proman'), ('Artus'), ('Supplay'), ('Start People'), ('Kelly Services'), ('Gi Group'),
  ('Adéquat'), ('Adequat'), ('Triangle'), ('Samsic'), ('Domino'), ('Lynx RH'), ('Aquila RH'),
  ('Alphéa Conseil'), ('Alphea Conseil'), ('Fed'), ('Cabéo'), ('Cabeo'), ('Akkodis'), ('Adzuna'),
  ('Meteojob'), ('Indeed'), ('Monster'), ('Jobteaser'), ('Keljob'), ('LHH'), ('Lee Hecht Harrison'),
  ('Badenoch'), ('Aston Carter'), ('Talent.com'), ('Bruce'), ('Iziwork'), ('Qapa'), ('Mistertemp'),
  ('Mister Temp'), ('Interaction'), ('Lip'), ('Groupe Lip'), ('Partnaire'), ('Camo'),
  ('Aboutir Emploi'), ('Ace Emploi'), ('Job&box'), ('Job & Box'), ('Manpower Group'),
  ('Groupe Manpower'), ('Cabinet de Recrutement'), ('Agence d''intérim'), ('Agence d''interim'),
  ('Agence de Recrutement'), ('Recrutement Par'), ('Recrute Pour Son Client'),
  ('Recrute Pour l''un de ses Clients'), ('Notre Client'), ('Talent In Sight'),
  ('Field & Solutions'), ('Field and Solutions'), ('Aeos'), ('Recrutimmo'), ('Uptoo'),
  ('RH Performance'), ('Approach People'), ('Hellowork'), ('Regionsjob'), ('Opensourcing'),
  ('Sbc Consulting'), ('Potentiel Humain'), ('Harry Hope'), ('Nextep'), ('Elysee Consultants'),
  ('Winsearch'), ('Hunteo'), ('Talentis Horizon'), ('Page Group'), ('Spring Professional'),
  ('Plus Que Pro'), ('Axeo Services'), ('O2 Care Services'), ('Concorde RH'), ('RH Solutions'),
  ('Eurecia RH'), ('Rhf'), ('Blue Search'), ('Dgb Recrutement'), ('Choazan'), ('Nextgen RH'),
  ('Kalixens'), ('Acass'), ('Lea Linking'), ('Mercato de l''emploi'), ('Robert Walters'),
  ('Approche Directe'), ('Keltis'), ('Sasmic Emploi'), ('Mon Client'), ('Action Ouest Conseil'),
  ('Florian Mantione'), ('Fmi '), ('Initial '), ('Sup Interim'), ('Sup Intérim'),
  ('Metier Interim'), ('Métier Intérim'), ('Apk Conseil'), ('Ergalis'), ('Job Link'),
  ('De Graët'), ('Cadres en Mission'), ('Reseau Talents'), ('Réseau Talents'), ('L''iscod'),
  ('Iscod'), ('Teorhem'), ('Exaltan'), ('Abalone'), ('Inexia'), ('Menway'), ('Welljob'),
  ('Well Job'), ('Talents Business'), ('Talents Executive'), ('Talentskills'), ('Talent Skills'),
  ('Bon Talent'), ('Find Your Staff'), ('Findyourstaff'), ('Forstaff'), ('Md Skills'),
  ('Vidal Associates'), ('Les Colettes Sourcing'), ('Colettes Sourcing'), ('Management Square'),
  ('Groupe Piment'), ('Hc Resources'), ('Joshua RH'), ('Sapiance'), ('Storme RH'), ('Umanum'),
  ('Medijob'), ('Orient''action'), ('R2t Placement'), ('Casajob'), ('Achil'), ('Force Plus'),
  ('Ethic Interim'), ('Sad''s Interim'), ('Littoral Holding'), ('Effektiv'), ('Marvesting'),
  ('Voluntae'), ('Charly'), ('Lea Recrutement'), ('Expansion Personnel'), ('Page Executive'),
  ('Skayl'), ('Pro-fyl'), ('Skillie'), ('Pépite.'), ('Upyourbizz'), ('Up Your Bizz'), ('Refea'),
  ('Trimane'), ('Impactup'), ('Impact Up'), ('Ikiway'), ('Sincrone'), ('Collective.work'),
  ('Optineris'), ('Adarha'), ('Major Consulting'), ('Odas Conseil'), ('Pleiade Consulting'),
  ('T Consulting'), ('Alp''emploi'), ('Job Direct'), ('Alternativ''emploi'), ('Expert & Manager'),
  ('Lsa Commerce & Consommation'), ('L''école Française'), ('Prisma Formation'), ('E2se'),
  ('Iesa'), ('Momenti'), ('Local.fr'), ('Version Cc'), ('My Energy'), ('talents commerciaux'),
  ('opt''in recrutement'), ('m&s strategy'), ('orah conseil')
) AS x(name)
ON CONFLICT (name_normalized) DO NOTHING;

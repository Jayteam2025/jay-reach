-- Migration: blacklist persistante des cabinets de recrutement / intermediaires.
--
-- Probleme : avant, la liste des cabinets etait hardcodee dans signal-processor.ts.
-- A chaque nouveau cabinet detecte par Claude pendant le scoring, il fallait :
--   1. l'ajouter manuellement au code
--   2. redeployer scrape-job-signals
-- Avec une centaine de cabinets deja en liste et le scoring qui en trouve d'autres
-- a chaque run, ce process freinait le filtrage.
--
-- Solution : table DB qui auto-apprend depuis le scoring + remplace la liste hardcodee.
-- Quand Claude met score=0 + reason mentionne "cabinet/intermediaire/recrute pour", on
-- INSERT into recruitment_agencies_blacklist (avec un detected_count qui s'incremente
-- si le meme nom revient plusieurs fois -> signal de fiabilite).

CREATE TABLE IF NOT EXISTS public.recruitment_agencies_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_normalized text NOT NULL UNIQUE,
  name_display text,
  source text NOT NULL CHECK (source IN ('seed_hardcoded', 'auto_score', 'manual')),
  detected_count int NOT NULL DEFAULT 1,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_recruitment_agencies_blacklist_name
  ON public.recruitment_agencies_blacklist (name_normalized);

ALTER TABLE public.recruitment_agencies_blacklist ENABLE ROW LEVEL SECURITY;

-- Lecture : admins uniquement (via JWT)
DROP POLICY IF EXISTS recruitment_agencies_admin_read ON public.recruitment_agencies_blacklist;
CREATE POLICY recruitment_agencies_admin_read
  ON public.recruitment_agencies_blacklist
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Helper : normalise un nom de boite pour matching (lowercase + retire espaces/tirets/apostrophes/accents)
CREATE OR REPLACE FUNCTION public.normalize_agency_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = 'public'
AS $$
  SELECT regexp_replace(
    lower(
      translate(
        coalesce(input, ''),
        'àáâäãåèéêëìíîïòóôöõùúûüñçÿýÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÑÇŸÝ',
        'aaaaaaeeeeiiiiooooouuuuncyyAAAAAAEEEEIIIIOOOOOUUUUNCYY'
      )
    ),
    '[\s\-'']',
    '',
    'g'
  );
$$;

COMMENT ON TABLE public.recruitment_agencies_blacklist IS
  'Cabinets de recrutement / intermediaires a exclure du pipeline prospection. Auto-apprentissage depuis scoring : Claude met score=0 + reason "cabinet/intermediaire" -> INSERT auto avec source=auto_score.';

-- Seed avec la liste hardcodee actuelle (~125 noms). source=seed_hardcoded.
-- name_normalized produit par normalize_agency_name (cote SQL pour rester coherent).
INSERT INTO public.recruitment_agencies_blacklist (name_normalized, name_display, source) VALUES
  (public.normalize_agency_name('Adecco'), 'Adecco', 'seed_hardcoded'),
  (public.normalize_agency_name('Manpower'), 'Manpower', 'seed_hardcoded'),
  (public.normalize_agency_name('Randstad'), 'Randstad', 'seed_hardcoded'),
  (public.normalize_agency_name('Hays'), 'Hays', 'seed_hardcoded'),
  (public.normalize_agency_name('Michael Page'), 'Michael Page', 'seed_hardcoded'),
  (public.normalize_agency_name('Page Personnel'), 'Page Personnel', 'seed_hardcoded'),
  (public.normalize_agency_name('Robert Half'), 'Robert Half', 'seed_hardcoded'),
  (public.normalize_agency_name('Spring'), 'Spring', 'seed_hardcoded'),
  (public.normalize_agency_name('Expectra'), 'Expectra', 'seed_hardcoded'),
  (public.normalize_agency_name('Synergie'), 'Synergie', 'seed_hardcoded'),
  (public.normalize_agency_name('Crit'), 'Crit', 'seed_hardcoded'),
  (public.normalize_agency_name('Actual'), 'Actual', 'seed_hardcoded'),
  (public.normalize_agency_name('Temporis'), 'Temporis', 'seed_hardcoded'),
  (public.normalize_agency_name('Proman'), 'Proman', 'seed_hardcoded'),
  (public.normalize_agency_name('Artus'), 'Artus', 'seed_hardcoded'),
  (public.normalize_agency_name('Supplay'), 'Supplay', 'seed_hardcoded'),
  (public.normalize_agency_name('Start People'), 'Start People', 'seed_hardcoded'),
  (public.normalize_agency_name('Kelly Services'), 'Kelly Services', 'seed_hardcoded'),
  (public.normalize_agency_name('Gi Group'), 'Gi Group', 'seed_hardcoded'),
  (public.normalize_agency_name('Adequat'), 'Adequat', 'seed_hardcoded'),
  (public.normalize_agency_name('Triangle'), 'Triangle', 'seed_hardcoded'),
  (public.normalize_agency_name('Samsic'), 'Samsic', 'seed_hardcoded'),
  (public.normalize_agency_name('Domino'), 'Domino', 'seed_hardcoded'),
  (public.normalize_agency_name('Lynx RH'), 'Lynx RH', 'seed_hardcoded'),
  (public.normalize_agency_name('Aquila RH'), 'Aquila RH', 'seed_hardcoded'),
  (public.normalize_agency_name('Alphea Conseil'), 'Alphea Conseil', 'seed_hardcoded'),
  (public.normalize_agency_name('Fed'), 'Fed', 'seed_hardcoded'),
  (public.normalize_agency_name('Cabeo'), 'Cabeo', 'seed_hardcoded'),
  (public.normalize_agency_name('Akkodis'), 'Akkodis', 'seed_hardcoded'),
  (public.normalize_agency_name('Adzuna'), 'Adzuna', 'seed_hardcoded'),
  (public.normalize_agency_name('Meteojob'), 'Meteojob', 'seed_hardcoded'),
  (public.normalize_agency_name('Indeed'), 'Indeed', 'seed_hardcoded'),
  (public.normalize_agency_name('Monster'), 'Monster', 'seed_hardcoded'),
  (public.normalize_agency_name('Jobteaser'), 'Jobteaser', 'seed_hardcoded'),
  (public.normalize_agency_name('Keljob'), 'Keljob', 'seed_hardcoded'),
  (public.normalize_agency_name('LHH'), 'LHH', 'seed_hardcoded'),
  (public.normalize_agency_name('Lee Hecht Harrison'), 'Lee Hecht Harrison', 'seed_hardcoded'),
  (public.normalize_agency_name('Badenoch'), 'Badenoch', 'seed_hardcoded'),
  (public.normalize_agency_name('Aston Carter'), 'Aston Carter', 'seed_hardcoded'),
  (public.normalize_agency_name('Talent.com'), 'Talent.com', 'seed_hardcoded'),
  (public.normalize_agency_name('Bruce'), 'Bruce', 'seed_hardcoded'),
  (public.normalize_agency_name('Iziwork'), 'Iziwork', 'seed_hardcoded'),
  (public.normalize_agency_name('Qapa'), 'Qapa', 'seed_hardcoded'),
  (public.normalize_agency_name('Mistertemp'), 'Mistertemp', 'seed_hardcoded'),
  (public.normalize_agency_name('Mister Temp'), 'Mister Temp', 'seed_hardcoded'),
  (public.normalize_agency_name('Interaction'), 'Interaction', 'seed_hardcoded'),
  (public.normalize_agency_name('LIP'), 'LIP', 'seed_hardcoded'),
  (public.normalize_agency_name('Groupe LIP'), 'Groupe LIP', 'seed_hardcoded'),
  (public.normalize_agency_name('Partnaire'), 'Partnaire', 'seed_hardcoded'),
  (public.normalize_agency_name('Camo'), 'Camo', 'seed_hardcoded'),
  (public.normalize_agency_name('Aboutir Emploi'), 'Aboutir Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('Ace Emploi'), 'Ace Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('Job&Box'), 'Job&Box', 'seed_hardcoded'),
  (public.normalize_agency_name('Manpower Group'), 'Manpower Group', 'seed_hardcoded'),
  (public.normalize_agency_name('Groupe Manpower'), 'Groupe Manpower', 'seed_hardcoded'),
  (public.normalize_agency_name('Talent In Sight'), 'Talent In Sight', 'seed_hardcoded'),
  (public.normalize_agency_name('Field & Solutions'), 'Field & Solutions', 'seed_hardcoded'),
  (public.normalize_agency_name('Aeos'), 'Aeos', 'seed_hardcoded'),
  (public.normalize_agency_name('Recrutimmo'), 'Recrutimmo', 'seed_hardcoded'),
  (public.normalize_agency_name('Uptoo'), 'Uptoo', 'seed_hardcoded'),
  (public.normalize_agency_name('RH Performance'), 'RH Performance', 'seed_hardcoded'),
  (public.normalize_agency_name('Approach People'), 'Approach People', 'seed_hardcoded'),
  (public.normalize_agency_name('Hellowork'), 'Hellowork', 'seed_hardcoded'),
  (public.normalize_agency_name('Regionsjob'), 'Regionsjob', 'seed_hardcoded'),
  (public.normalize_agency_name('Opensourcing'), 'Opensourcing', 'seed_hardcoded'),
  (public.normalize_agency_name('SBC Consulting'), 'SBC Consulting', 'seed_hardcoded'),
  (public.normalize_agency_name('Potentiel Humain'), 'Potentiel Humain', 'seed_hardcoded'),
  (public.normalize_agency_name('Harry Hope'), 'Harry Hope', 'seed_hardcoded'),
  (public.normalize_agency_name('Nextep'), 'Nextep', 'seed_hardcoded'),
  (public.normalize_agency_name('Elysee Consultants'), 'Elysee Consultants', 'seed_hardcoded'),
  (public.normalize_agency_name('Winsearch'), 'Winsearch', 'seed_hardcoded'),
  (public.normalize_agency_name('Hunteo'), 'Hunteo', 'seed_hardcoded'),
  (public.normalize_agency_name('Talentis Horizon'), 'Talentis Horizon', 'seed_hardcoded'),
  (public.normalize_agency_name('Page Group'), 'Page Group', 'seed_hardcoded'),
  (public.normalize_agency_name('Spring Professional'), 'Spring Professional', 'seed_hardcoded'),
  (public.normalize_agency_name('Plus Que Pro'), 'Plus Que Pro', 'seed_hardcoded'),
  (public.normalize_agency_name('Axeo Services'), 'Axeo Services', 'seed_hardcoded'),
  (public.normalize_agency_name('O2 Care Services'), 'O2 Care Services', 'seed_hardcoded'),
  (public.normalize_agency_name('Concorde RH'), 'Concorde RH', 'seed_hardcoded'),
  (public.normalize_agency_name('RH Solutions'), 'RH Solutions', 'seed_hardcoded'),
  (public.normalize_agency_name('Eurecia RH'), 'Eurecia RH', 'seed_hardcoded'),
  (public.normalize_agency_name('RHF'), 'RHF', 'seed_hardcoded'),
  (public.normalize_agency_name('Blue Search'), 'Blue Search', 'seed_hardcoded'),
  (public.normalize_agency_name('DGB Recrutement'), 'DGB Recrutement', 'seed_hardcoded'),
  (public.normalize_agency_name('Choazan'), 'Choazan', 'seed_hardcoded'),
  (public.normalize_agency_name('Nextgen RH'), 'Nextgen RH', 'seed_hardcoded'),
  (public.normalize_agency_name('Kalixens'), 'Kalixens', 'seed_hardcoded'),
  (public.normalize_agency_name('Acass'), 'Acass', 'seed_hardcoded'),
  (public.normalize_agency_name('Lea Linking'), 'Lea Linking', 'seed_hardcoded'),
  (public.normalize_agency_name('Mercato de l Emploi'), 'Mercato de l''Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('Robert Walters'), 'Robert Walters', 'seed_hardcoded'),
  (public.normalize_agency_name('Approche Directe'), 'Approche Directe', 'seed_hardcoded'),
  (public.normalize_agency_name('Keltis'), 'Keltis', 'seed_hardcoded'),
  (public.normalize_agency_name('Sasmic Emploi'), 'Sasmic Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('Action Ouest Conseil'), 'Action Ouest Conseil', 'seed_hardcoded'),
  (public.normalize_agency_name('Florian Mantione'), 'Florian Mantione', 'seed_hardcoded'),
  (public.normalize_agency_name('Sup Interim'), 'Sup Interim', 'seed_hardcoded'),
  (public.normalize_agency_name('Metier Interim'), 'Metier Interim', 'seed_hardcoded'),
  (public.normalize_agency_name('APK Conseil'), 'APK Conseil', 'seed_hardcoded'),
  (public.normalize_agency_name('Ergalis'), 'Ergalis', 'seed_hardcoded'),
  (public.normalize_agency_name('Job Link'), 'Job Link', 'seed_hardcoded'),
  (public.normalize_agency_name('De Graet'), 'De Graet', 'seed_hardcoded'),
  (public.normalize_agency_name('Cadres en Mission'), 'Cadres en Mission', 'seed_hardcoded'),
  (public.normalize_agency_name('Reseau Talents'), 'Reseau Talents', 'seed_hardcoded'),
  (public.normalize_agency_name('Iscod'), 'Iscod', 'seed_hardcoded'),
  (public.normalize_agency_name('Teorhem'), 'Teorhem', 'seed_hardcoded'),
  (public.normalize_agency_name('Exaltan'), 'Exaltan', 'seed_hardcoded'),
  (public.normalize_agency_name('Abalone'), 'Abalone', 'seed_hardcoded'),
  (public.normalize_agency_name('Inexia'), 'Inexia', 'seed_hardcoded'),
  (public.normalize_agency_name('Menway'), 'Menway', 'seed_hardcoded'),
  (public.normalize_agency_name('Welljob'), 'Welljob', 'seed_hardcoded'),
  (public.normalize_agency_name('Talents Commerciaux'), 'Talents Commerciaux', 'seed_hardcoded'),
  (public.normalize_agency_name('Talents Business'), 'Talents Business', 'seed_hardcoded'),
  (public.normalize_agency_name('Talents Executive'), 'Talents Executive', 'seed_hardcoded'),
  (public.normalize_agency_name('Talentskills'), 'Talentskills', 'seed_hardcoded'),
  (public.normalize_agency_name('Bon Talent'), 'Bon Talent', 'seed_hardcoded'),
  (public.normalize_agency_name('Find Your Staff'), 'Find Your Staff', 'seed_hardcoded'),
  (public.normalize_agency_name('Forstaff'), 'Forstaff', 'seed_hardcoded'),
  (public.normalize_agency_name('MD Skills'), 'MD Skills', 'seed_hardcoded'),
  (public.normalize_agency_name('Vidal Associates'), 'Vidal Associates', 'seed_hardcoded'),
  (public.normalize_agency_name('Les Colettes Sourcing'), 'Les Colettes Sourcing', 'seed_hardcoded'),
  (public.normalize_agency_name('Management Square'), 'Management Square', 'seed_hardcoded'),
  (public.normalize_agency_name('Groupe Piment'), 'Groupe Piment', 'seed_hardcoded'),
  (public.normalize_agency_name('HC Resources'), 'HC Resources', 'seed_hardcoded'),
  (public.normalize_agency_name('Joshua RH'), 'Joshua RH', 'seed_hardcoded'),
  (public.normalize_agency_name('Sapiance'), 'Sapiance', 'seed_hardcoded'),
  (public.normalize_agency_name('Storme RH'), 'Storme RH', 'seed_hardcoded'),
  (public.normalize_agency_name('Umanum'), 'Umanum', 'seed_hardcoded'),
  (public.normalize_agency_name('Medijob'), 'Medijob', 'seed_hardcoded'),
  (public.normalize_agency_name('Orient Action'), 'Orient''Action', 'seed_hardcoded'),
  (public.normalize_agency_name('R2T Placement'), 'R2T Placement', 'seed_hardcoded'),
  (public.normalize_agency_name('Casajob'), 'Casajob', 'seed_hardcoded'),
  (public.normalize_agency_name('Achil'), 'Achil', 'seed_hardcoded'),
  (public.normalize_agency_name('Force Plus'), 'Force Plus', 'seed_hardcoded'),
  (public.normalize_agency_name('Ethic Interim'), 'Ethic Interim', 'seed_hardcoded'),
  (public.normalize_agency_name('Sad s Interim'), 'Sad''s Interim', 'seed_hardcoded'),
  (public.normalize_agency_name('Littoral Holding'), 'Littoral Holding', 'seed_hardcoded'),
  (public.normalize_agency_name('Effektiv'), 'Effektiv', 'seed_hardcoded'),
  (public.normalize_agency_name('Marvesting'), 'Marvesting', 'seed_hardcoded'),
  (public.normalize_agency_name('Voluntae'), 'Voluntae', 'seed_hardcoded'),
  (public.normalize_agency_name('Opt In Recrutement'), 'Opt''In Recrutement', 'seed_hardcoded'),
  (public.normalize_agency_name('Charly'), 'Charly', 'seed_hardcoded'),
  (public.normalize_agency_name('Lea Recrutement'), 'Lea Recrutement', 'seed_hardcoded'),
  (public.normalize_agency_name('Expansion Personnel'), 'Expansion Personnel', 'seed_hardcoded'),
  (public.normalize_agency_name('Page Executive'), 'Page Executive', 'seed_hardcoded'),
  (public.normalize_agency_name('Skayl'), 'Skayl', 'seed_hardcoded'),
  (public.normalize_agency_name('Pro-Fyl'), 'Pro-Fyl', 'seed_hardcoded'),
  (public.normalize_agency_name('Skillie'), 'Skillie', 'seed_hardcoded'),
  (public.normalize_agency_name('Pepite'), 'Pepite', 'seed_hardcoded'),
  (public.normalize_agency_name('Upyourbizz'), 'Upyourbizz', 'seed_hardcoded'),
  (public.normalize_agency_name('Refea'), 'Refea', 'seed_hardcoded'),
  (public.normalize_agency_name('Trimane'), 'Trimane', 'seed_hardcoded'),
  (public.normalize_agency_name('Impactup'), 'Impactup', 'seed_hardcoded'),
  (public.normalize_agency_name('Ikiway'), 'Ikiway', 'seed_hardcoded'),
  (public.normalize_agency_name('Sincrone'), 'Sincrone', 'seed_hardcoded'),
  (public.normalize_agency_name('Collective Work'), 'Collective.Work', 'seed_hardcoded'),
  (public.normalize_agency_name('Optineris'), 'Optineris', 'seed_hardcoded'),
  (public.normalize_agency_name('Adarha'), 'Adarha', 'seed_hardcoded'),
  (public.normalize_agency_name('Major Consulting'), 'Major Consulting', 'seed_hardcoded'),
  (public.normalize_agency_name('Odas Conseil'), 'Odas Conseil', 'seed_hardcoded'),
  (public.normalize_agency_name('Pleiade Consulting'), 'Pleiade Consulting', 'seed_hardcoded'),
  (public.normalize_agency_name('T Consulting'), 'T Consulting', 'seed_hardcoded'),
  (public.normalize_agency_name('Alp Emploi'), 'Alp''Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('Job Direct'), 'Job Direct', 'seed_hardcoded'),
  (public.normalize_agency_name('Alternativ Emploi'), 'Alternativ''Emploi', 'seed_hardcoded'),
  (public.normalize_agency_name('M&S Strategy'), 'M&S Strategy', 'seed_hardcoded'),
  (public.normalize_agency_name('Expert & Manager'), 'Expert & Manager', 'seed_hardcoded'),
  (public.normalize_agency_name('Momenti'), 'Momenti', 'seed_hardcoded'),
  (public.normalize_agency_name('Local.fr'), 'Local.fr', 'seed_hardcoded'),
  (public.normalize_agency_name('Orah Conseil'), 'Orah Conseil', 'seed_hardcoded'),
  (public.normalize_agency_name('Version CC'), 'Version CC', 'seed_hardcoded'),
  (public.normalize_agency_name('My Energy'), 'My Energy', 'seed_hardcoded'),
  -- Cas remontés dans le screening 18/05 (Trello + UI)
  (public.normalize_agency_name('CONNECTT'), 'CONNECTT', 'seed_hardcoded'),
  (public.normalize_agency_name('STRADA Marketing'), 'STRADA Marketing', 'seed_hardcoded'),
  (public.normalize_agency_name('Profil Plus'), 'Profil Plus', 'seed_hardcoded'),
  (public.normalize_agency_name('Alter Ego'), 'Alter Ego', 'seed_hardcoded'),
  (public.normalize_agency_name('TALENTPEOPLE'), 'TALENTPEOPLE', 'seed_hardcoded'),
  (public.normalize_agency_name('C2RH'), 'C2RH', 'seed_hardcoded'),
  -- Detectes par Claude dans le scoring du 2026-05-18 (source = auto_score, ce
  -- batch sera le 1er enregistrement post-deploiement de la logique d'auto-learn).
  (public.normalize_agency_name('AGRI TEAM'), 'AGRI TEAM', 'auto_score'),
  (public.normalize_agency_name('asap.work'), 'asap.work', 'auto_score'),
  (public.normalize_agency_name('BizBy'), 'BizBy', 'auto_score'),
  (public.normalize_agency_name('CONNECTT GRAND EST'), 'CONNECTT GRAND EST', 'auto_score'),
  (public.normalize_agency_name('GRAINES & COMPETENCES'), 'GRAINES & COMPETENCES', 'auto_score'),
  (public.normalize_agency_name('HYPERION CONSULTING'), 'HYPERION CONSULTING', 'auto_score'),
  (public.normalize_agency_name('LB Ressources'), 'LB Ressources', 'auto_score'),
  (public.normalize_agency_name('MARSEILLE INDUSTRIE'), 'MARSEILLE INDUSTRIE', 'auto_score'),
  (public.normalize_agency_name('M&J TRUSTED PARTNERS'), 'M&J TRUSTED PARTNERS', 'auto_score'),
  (public.normalize_agency_name('M&J TRUSTED RECRUITMENT'), 'M&J TRUSTED RECRUITMENT', 'auto_score'),
  (public.normalize_agency_name('Nexus HR'), 'Nexus HR', 'auto_score'),
  (public.normalize_agency_name('Nigel Frank International'), 'Nigel Frank International', 'auto_score'),
  (public.normalize_agency_name('ONOS TALENTS'), 'ONOS TALENTS', 'auto_score'),
  (public.normalize_agency_name('RECRUTOI'), 'RECRUTOI', 'auto_score'),
  (public.normalize_agency_name('Red Hot Talents'), 'Red Hot Talents', 'auto_score'),
  (public.normalize_agency_name('Rocket4Sales'), 'Rocket4Sales', 'auto_score'),
  (public.normalize_agency_name('Sensace'), 'Sensace', 'auto_score'),
  (public.normalize_agency_name('Sensace Carriere'), 'Sensace Carrière', 'auto_score'),
  (public.normalize_agency_name('Synchrone Fr'), 'Synchrone Fr', 'auto_score'),
  (public.normalize_agency_name('Talenteeds'), 'Talenteeds', 'auto_score'),
  (public.normalize_agency_name('TIMTARGETT'), 'TIMTARGETT', 'auto_score'),
  (public.normalize_agency_name('Wake It Up'), 'Wake It Up', 'auto_score'),
  (public.normalize_agency_name('WIZBII'), 'WIZBII', 'auto_score')
ON CONFLICT (name_normalized) DO NOTHING;

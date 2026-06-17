import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ScrapedSignal, IcpCriteria } from './types.ts';
import { isHoneypotEmail } from './honeypot-detector.ts';
import { looksLikeJobTitleFragment } from './company-name-validator.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export interface ProcessSignalsResult {
  inserted: number;
  duplicates: number;
  dismissed: number;
}

// Blacklist des cabinets : 100% en DB (table recruitment_agencies_blacklist), plus de liste hardcodée (dé-hardcoding PR5).

/**
 * Pattern-based company name exclusion — catches future intermediaries
 * These patterns in a company name = automatic exclusion
 */
const INTERMEDIARY_NAME_PATTERNS = /\b(recrutement|recruiting|intérim|interim|staffing|placement|headhunt|chasseur de t[eê]tes|strategy|stratégie|cabinet (conseil|rh|recrutement)|conseil rh|conseil (en )?recrutement|people strategy|talent strategy|advisory|executive search)\b/i;

/**
 * Small-company "Conseil" detection : un nom compose "XXX Conseil" ou
 * "Conseil XXX" quand XXX fait < 12 chars est quasi toujours un cabinet
 * de recrutement / conseil, pas un employeur direct ICP.
 * Matche : "ORAH Conseil", "HR Conseil", "Adexx Conseil".
 * Ne matche pas : "Conseil Départemental de Paris" (trop long).
 */
const SHORT_CONSEIL_PATTERN = /^[a-zà-ÿ0-9&'.\s]{1,12}\s+conseil(\s|$)/i;

/**
 * Schools / training — not employers
 */
const SCHOOL_PATTERNS = /\b(business school|école|ecole|formation|alternance|mbway|epitech|iscod|aftral|apprentissage)\b/i;

/**
 * MLM / franchise development / direct selling networks
 */
const MLM_FRANCHISE_PATTERNS = /\b(vente directe|vente de proximité|mlm|franchise|devenir franchisé|créer votre|ouvrir votre)\b/i;

/**
 * La Poste internal entities
 */
const POSTE_INTERNAL_PATTERNS = /^(filiales|reseau|réseau)$/i;

/**
 * Patterns in raw_content that indicate non-relevant offers
 */
const CONTENT_BLACKLIST = [
  // Offres de CREATION de franchise (pas recrutement chez un franchisé)
  'investissement initial',
  'droit d\'entrée',
  'apport personnel nécessaire',
  'devenir franchisé',
  'créer votre franchise',
  'ouvrir votre agence',
  'centre de profit franchisé',
  // Mandataires / indépendants
  'réseau de mandataires',
  'agent commercial indépendant',
  'agent immobilier indépendant',
];

/**
 * Company names that are clearly garbage extractions
 */
// Companies that aren't commercial targets (housing, consulting)
const EXCLUDED_COMPANIES = [
  'immobilière3f', 'immobiliere3f', '3f immobilier',
  'wavestone',
  // Franchise/MLM réseaux
  'osm expert', 'osm leader', 'o2 developpement', 'o2 développement',
  'bscc', 'concepteur vendeur', 'vitalliance', 'domusvi',
  'direction de développement vitalis', 'la maison sereine',
  // La Poste interne
  'filiales service courrier', 'filiales reseau', 'filiales réseau',
  'le groupe la poste',
  // Syntix/Axelion (réseau commercial sous-traitant)
  'syntix', 'axelion',
];

const INVALID_COMPANY_NAMES = [
  'f/h', 'h/f', 'm/f', 'f/m',
  'l\'entreprise', 'entreprise', 'confidentiel',
  'ce poste', 'mdcv', 'alors',
  // Descriptions/adjectifs qui ne sont pas des noms d'entreprise
  'enthousiaste et persévérant', 'enthousiaste et perseverant',
  'manager les équipes', 'chargés de clientèle',
  'ouest', 'nord', 'sud', 'est', 'centre',
  'france', 'belgique', 'suisse',
  // Villes françaises
  'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'lille', 'nantes',
  'strasbourg', 'rennes', 'grenoble', 'rouen', 'dijon', 'montpellier', 'nice',
  'reims', 'toulon', 'clermont-ferrand', 'aix-en-provence', 'saint-etienne',
  'le mans', 'le havre', 'amiens', 'limoges', 'perpignan', 'besancon',
  'orleans', 'mulhouse', 'nancy', 'metz', 'caen', 'tours', 'angers',
  'brest', 'poitiers', 'pau', 'avignon', 'valence', 'dunkerque', 'colmar',
  'troyes', 'lorient', 'bayonne', 'chambery', 'annecy', 'belfort',
  'quimper', 'vannes', 'saint-brieuc', 'aubagne', 'saint-nazaire',
  'villeurbanne', 'vitry-sur-seine', 'nanterre', 'creteil', 'argenteuil',
  'montreuil', 'boulogne-billancourt', 'saint-denis', 'versailles',
  'la rochelle', 'cannes', 'antibes', 'calais', 'hyeres',
  // Villes belges & suisses
  'bruxelles', 'liege', 'namur', 'charleroi', 'mons', 'gand', 'anvers',
  'geneve', 'lausanne', 'fribourg', 'neuchatel', 'sion', 'berne', 'zurich',
];

/**
 * Charge la blacklist des cabinets depuis la DB (table recruitment_agencies_blacklist).
 * Retourne un objet { normalized: Set<string>; names: string[] } pour :
 *   - normalized : O(1) lookup sur noms normalisés (sans espaces/traits)
 *   - names : tableau des noms bruts en minuscules pour pattern "recrute pour X"
 */
export async function loadRecruitmentBlacklist(): Promise<{ normalized: Set<string>; names: string[] }> {
  try {
    const { data, error } = await supabase
      .from('recruitment_agencies_blacklist')
      .select('name, name_normalized');
    if (error || !data || data.length === 0) {
      console.warn('[blacklist] table vide ou inaccessible, aucune agence filtrée:', error?.message);
      return { normalized: new Set(), names: [] };
    }
    const normalized = new Set<string>(
      data.map((r: { name_normalized: string }) => r.name_normalized)
    );
    const names = data.map((r: { name: string }) => r.name.toLowerCase());
    return { normalized, names };
  } catch (err) {
    console.warn('[blacklist] Exception loading blacklist:', err);
    return { normalized: new Set(), names: [] };
  }
}

function isRecruitmentAgency(
  companyName: string | null | undefined,
  rawContent: string,
  blacklist: { normalized: Set<string>; names: string[] },
): boolean {
  if (!companyName && !rawContent) return false;
  const companyLower = (companyName || '').toLowerCase();
  // Normalise : retire espaces + traits d'union pour matcher les variantes
  // collees type "Findyourstaff" contre "find your staff" dans la liste.
  const companyNormalized = companyLower.replace(/[\s\-']/g, '');
  // Match strict sur la blacklist DB (O(1) sur Set)
  if (blacklist.normalized.has(companyNormalized)) return true;
  // Match substring : agency >= 5 chars contenu dans companyNormalized
  for (const agencyNormalized of blacklist.normalized) {
    if (agencyNormalized.length >= 5 && companyNormalized.includes(agencyNormalized)) {
      return true;
    }
  }
  // Exact match for short names that would false-positive with includes
  if (['ltd'].includes(companyLower.trim())) return true;
  // Pattern-based detection — company names containing these words are almost always agencies
  if (INTERMEDIARY_NAME_PATTERNS.test(companyLower)) return true;
  // Short name followed by "Conseil" = cabinet RH/recrutement quasi garanti
  if (SHORT_CONSEIL_PATTERN.test(companyLower)) return true;
  // "X RH" at end of name
  if (/\brh$/i.test(companyLower.trim())) return true;
  // Schools / formations — not employers
  if (SCHOOL_PATTERNS.test(companyLower)) return true;
  // MLM / franchise development
  if (MLM_FRANCHISE_PATTERNS.test(companyLower)) return true;
  // La Poste internal entities (exact match)
  if (POSTE_INTERNAL_PATTERNS.test(companyLower.trim())) return true;
  // Company name is a phrase (likely garbage extraction: "Manager les équipes...")
  if (companyLower.split(' ').length >= 5 && /\b(les|des|de|du|la|le|un|une|et|ou|en|pour|avec|votre|notre|son|ses)\b/.test(companyLower)) {
    // 5+ words with French articles = probably a description, not a company name
    return true;
  }
  // Check raw_content for agency patterns - "recrute pour X" / "par X"
  // (utilise les noms de la blacklist DB car le rawContent contient des espaces)
  const contentLower = rawContent.toLowerCase();
  if (blacklist.names.some(agency => contentLower.includes(`recrute pour ${agency}`) || contentLower.includes(`par ${agency}`))) return true;
  // Content mentions "notre client" = intermediary
  if (/\bnotre client\b/i.test(contentLower.substring(0, 300))) return true;
  return false;
}

function isBlacklistedContent(rawContent: string): boolean {
  if (!rawContent) return false;
  const lower = rawContent.toLowerCase();
  return CONTENT_BLACKLIST.some(pattern => lower.includes(pattern));
}

/**
 * Build searchable content from signal — normalized for ICP matching
 */
function buildSearchableContent(signal: ScrapedSignal): string {
  const parts = [
    signal.extracted_data.job_title,
    signal.extracted_data.description,
    signal.raw_content,
  ].filter(Boolean);

  return parts.join(' ')
    // Strip gender markers that break keyword matching: "Commercial(e)" → "Commercial"
    .replace(/\(e\)/gi, '')
    // Strip "(H/F)", "(F/H)", "(F/M)", "(m/f)" etc.
    .replace(/\s*\([HFMhfm]\/[HFMhfm]\)\s*/g, ' ')
    .toLowerCase();
}

/**
 * Check if a signal matches ICP criteria
 */
export function matchSignalToIcp(signal: ScrapedSignal, filter: IcpCriteria): boolean {
  const searchContent = buildSearchableContent(signal);

  // Must match at least one job_keywords entry
  const hasMatchingKeyword = filter.job_keywords.some(keyword =>
    searchContent.includes(keyword.toLowerCase())
  );

  if (!hasMatchingKeyword) {
    return false;
  }

  // Must NOT match any exclude_keywords — check TITLE only (not full description)
  // Reason: "stage de formation" in onboarding description ≠ actual internship offer
  if (filter.exclude_keywords && filter.exclude_keywords.length > 0) {
    const titleContent = (signal.extracted_data.job_title || '')
      .replace(/\(e\)/gi, '')
      .replace(/\s*\([HFMhfm]\/[HFMhfm]\)\s*/g, ' ')
      .toLowerCase();
    const hasExcludedKeyword = filter.exclude_keywords.some(keyword =>
      titleContent.includes(keyword.toLowerCase())
    );

    if (hasExcludedKeyword) {
      return false;
    }
  }

  // If regions defined and location exists, must match at least one region
  if (filter.regions && filter.regions.length > 0 && signal.extracted_data.location) {
    const locationLower = signal.extracted_data.location.toLowerCase();
    const hasMatchingRegion = filter.regions.some(region =>
      locationLower.includes(region.toLowerCase())
    );

    if (!hasMatchingRegion) {
      return false;
    }
  }

  return true;
}


/**
 * Normalise un nom d'entreprise pour comparaison cross-semaine :
 * lowercase + trim + strip des suffixes juridiques (SAS, SARL, SA, France, etc.)
 * + ecrasement des espaces multiples.
 *
 * Utilise pour eviter qu'une boite deja scrapee la semaine d'avant
 * (sous forme de signal ou de profil enrichi) ne revienne en doublon.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    // Enleve parentheses "(H/F)", codes, etc.
    .replace(/\([^)]*\)/g, ' ')
    // Enleve les suffixes juridiques & geographiques courants
    .replace(/\b(sas|sarl|sa|sasu|eurl|snc|scp|scs|sci|selarl|selas|group|groupe|holding|distribution|france|europe|international|intl|internationale)\b/g, ' ')
    // Ponctuation → espace
    .replace(/[.,;:!?'"`\-_/\\]+/g, ' ')
    // Espaces multiples → simple
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Charge l'ensemble des noms d'entreprises deja presents dans la DB
 * (profils enrichis + signaux non rejetes). Utilise pour la dedup cross-semaine :
 * une boite deja traitee la semaine precedente ne doit pas revenir comme
 * nouveau signal si elle rapparait dans une autre offre.
 */
async function loadExistingCompanyNames(): Promise<Set<string>> {
  const existing = new Set<string>();

  // Supabase JS limite chaque SELECT a 1000 lignes par defaut. On force une
  // pagination explicite via range() pour ne PAS rater de doublons quand
  // prospect_profiles depasse 1000 (bug 2026-05-21 : Pomona/Geodis re-scrapes
  // alors qu'ils etaient enrichis, parce que dans les 190 dernieres lignes
  // manquantes).
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('prospect_profiles')
      .select('company_name')
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const n = normalizeCompanyName(row.company_name);
      if (n) existing.add(n);
    }
    if (data.length < PAGE) break;
  }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('prospect_signals')
      .select('company_name')
      .neq('status', 'dismissed')
      .range(offset, offset + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const n = normalizeCompanyName(row.company_name);
      if (n) existing.add(n);
    }
    if (data.length < PAGE) break;
  }

  return existing;
}

/**
 * Process scraped signals: dedup, ICP matching, and storage.
 *
 * Jay Reach 1.2.3.a : workspace_id est obligatoire (column NOT NULL).
 * trigger_id est optionnel mais recommande (permet de tracer quel trigger
 * a genere chaque signal).
 */
export async function processSignals(
  signals: ScrapedSignal[],
  icpFilters: IcpCriteria[],
  workspaceId: string,
  triggerId?: string | null
): Promise<ProcessSignalsResult> {
  const result: ProcessSignalsResult = {
    inserted: 0,
    duplicates: 0,
    dismissed: 0,
  };

  // Dedup cross-semaine : charge les noms d'entreprises deja en DB (profils
  // enrichis + signaux non dismiss) et skip les candidats qui matchent.
  // L'operateur peut ne pas avoir fini de traiter les boites de la semaine d'avant :
  // on ne doit pas les lui reproposer cette semaine comme des nouveautes.
  const existingCompanyNames = await loadExistingCompanyNames();
  console.log(`[processSignals] Dedup cross-semaine : ${existingCompanyNames.size} boites deja en DB`);

  // Blacklist persistante des cabinets / intermediaires (100% depuis DB)
  const recruitmentBlacklist = await loadRecruitmentBlacklist();
  console.log(`[processSignals] Blacklist cabinets chargee : ${recruitmentBlacklist.normalized.size} noms`);

  // Gate : exclure les intermediaires? (true par défaut = comportement Jay actuel préservé)
  let excludeIntermediaries = true;
  if (triggerId) {
    try {
      const { data } = await supabase
        .from('signal_triggers')
        .select('exclude_intermediaries')
        .eq('id', triggerId)
        .maybeSingle();
      excludeIntermediaries = data?.exclude_intermediaries ?? true;
    } catch (err) {
      console.warn(`[processSignals] Failed to load trigger ${triggerId} gate:`, err);
      excludeIntermediaries = true;
    }
  }
  console.log(`[processSignals] excludeIntermediaries=${excludeIntermediaries}`);

  // In-memory dedup by source_url before DB inserts (saves DB calls)
  const seenUrls = new Set<string>();
  const uniqueSignals = signals.filter(s => {
    const key = `${s.source}:${s.source_url}`;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  for (const signal of uniqueSignals) {
    try {
      // Skip signals without company name — can't prospect without knowing the company
      const companyName = signal.extracted_data.company_name;
      if (!companyName) {
        result.dismissed++;
        continue;
      }

      // Skip garbage company names (gender markers, generic words, directions)
      const companyLower = companyName.toLowerCase().trim();

      if (INVALID_COMPANY_NAMES.includes(companyLower)) {
        result.dismissed++;
        continue;
      }

      // Defense in depth: rejette les fragments de job title qui auraient
      // echappe au filtrage cote scraper (toutes sources confondues).
      if (looksLikeJobTitleFragment(companyName)) {
        console.log(`[processSignals] DISMISS job-title-fragment company_name: "${companyName}" (source=${signal.source}, url=${signal.source_url})`);
        result.dismissed++;
        continue;
      }

      // Skip specifically excluded companies
      if (EXCLUDED_COMPANIES.some(c => companyLower.includes(c))) {
        result.dismissed++;
        continue;
      }

      // Dedup cross-semaine : skip si deja en DB (profil ou signal non dismiss)
      const normalizedName = normalizeCompanyName(companyName);
      if (normalizedName && existingCompanyNames.has(normalizedName)) {
        result.duplicates++;
        continue;
      }

      // Skip company names that are just codes/numbers (e.g. "100126978W")
      if (/^\d+[A-Z]?$/i.test(companyName.trim())) {
        result.dismissed++;
        continue;
      }

      // Skip insurance & banking companies
      if (/\b(assurance|prévoyance|prevoyance|mutuelle|banque|bancaire)\b/.test(companyLower)) {
        result.dismissed++;
        continue;
      }
      // Known banks/insurers without obvious keywords in name
      const knownBanksInsurers = ['bpce', 'bnp', 'lcl', 'axa', 'april', 'maif', 'macif', 'maaf', 'gmf', 'allianz', 'groupama', 'generali', 'ag2r', 'gan prevoyance'];
      if (knownBanksInsurers.some(b => companyLower.startsWith(b) || companyLower.includes(` ${b}`))) {
        result.dismissed++;
        continue;
      }

      // Skip recruitment agencies - we only want direct employers (si gate actif)
      if (excludeIntermediaries && isRecruitmentAgency(signal.extracted_data.company_name, signal.raw_content, recruitmentBlacklist)) {
        result.dismissed++;
        continue;
      }

      // Skip non-commercial job titles
      const jobTitle = (signal.extracted_data.job_title || '').toLowerCase();
      if (/\b(secrétaire|secretaire|préparateur|preparateur|recouvrement|chef de projet|assistant[e]? d'agence|assistant[e]? marketing|technicien[ne]? itinérant|technicien[ne]? itinerant|technicien[ne]? sav|technicien[ne]? maintenance|directeur[rice]? de centre[s]? commerci|juriste|product owner|business analyst|data analyst|chargé[e]? d'affaires réglementaire|chargé[e]? d'affaires reglementaire|chargé[e]? d'affaires environnement|chargé[e]? d'affaires foncier|community manager|chef de produit|brand manager|contrôleur de gestion|controleur de gestion)\b/i.test(jobTitle)) {
        result.dismissed++;
        continue;
      }

      // Skip franchise offers, agent mandataire, etc.
      if (isBlacklistedContent(signal.raw_content)) {
        result.dismissed++;
        continue;
      }

      // Prepare signal data for insertion
      let email = signal.extracted_data.contact_email || null;
      if (email && isHoneypotEmail(email)) {
        email = null;
      }

      const signalData = {
        workspace_id: workspaceId,
        trigger_id: triggerId ?? null,
        signal_type: signal.signal_type,
        source: signal.source,
        source_url: signal.source_url,
        raw_content: signal.raw_content,
        company_name: signal.extracted_data.company_name || null,
        status: 'raw',
        extracted_data: {
          ...signal.extracted_data,
          contact_email: email,
        },
      };

      // Try to insert the signal
      const { error: insertError } = await supabase
        .from('prospect_signals')
        .insert([signalData]);

      if (insertError) {
        // Check if it's a duplicate (unique constraint violation)
        if (insertError.code === '23505') {
          result.duplicates++;
          continue;
        }
        // Log other errors but continue processing
        console.error(`Error inserting signal ${signal.source_url}:`, insertError);
        continue;
      }

      // Ajoute le nom au set pour dedup intra-run (plusieurs offres d'une meme boite)
      if (normalizedName) {
        existingCompanyNames.add(normalizedName);
      }

      // Check ICP match
      const matchesIcp = icpFilters.some(filter => matchSignalToIcp(signal, filter));

      if (!matchesIcp) {
        // Update status to 'dismissed'
        const { error: updateError } = await supabase
          .from('prospect_signals')
          .update({ status: 'dismissed' })
          .eq('source_url', signal.source_url)
          .eq('source', signal.source);

        if (updateError) {
          console.error(`Error dismissing signal ${signal.source_url}:`, updateError);
        }
        result.dismissed++;
      } else {
        result.inserted++;
      }
    } catch (error) {
      console.error(`Unexpected error processing signal:`, error);
    }
  }

  return result;
}

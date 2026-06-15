import type { Scraper, ScraperResult, ScrapedSignal } from './types.ts';
import { sanitizeScrapedContent } from './types.ts';
import { looksLikeJobTitleFragment } from './company-name-validator.ts';

interface FranceTravailOffer {
  id: string;
  intitule: string;
  entreprise?: { nom: string };
  lieuTravail?: { libelle: string };
  description?: string;
  contact?: { nom?: string; courriel?: string };
  dateCreation?: string;
  salaire?: { libelle?: string };
  typeContrat?: string;
  experienceExige?: string;
}

interface FranceTravailResponse {
  resultats?: FranceTravailOffer[];
  nbResultats?: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  // Check if we have a cached token that hasn't expired
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  if (!clientId || !clientSecret) {
    throw new Error('Missing FRANCE_TRAVAIL_CLIENT_ID or FRANCE_TRAVAIL_CLIENT_SECRET');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'api_offresdemploiv2 o2dsoffre');

  const response = await fetch(
    'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    throw new Error(`France Travail auth failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000 * 0.9), // Refresh at 90% of expiration
  };

  return data.access_token;
}

async function searchOffers(
  keywords: string,
  clientId: string,
  clientSecret: string,
  location?: string
): Promise<FranceTravailOffer[]> {
  const token = await getAccessToken(clientId, clientSecret);

  const params = new URLSearchParams();
  params.append('motsCles', keywords);
  params.append('range', '0-99');
  params.append('sort', '1'); // Sort by date

  if (location) {
    params.append('departement', location);
  }

  const response = await fetch(
    `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `France Travail search failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as FranceTravailResponse;
  return data.resultats || [];
}

/**
 * Extract company name from job description when entreprise.nom is missing (confidentiel)
 */
function extractCompanyFromDescription(description: string | undefined): string | null {
  if (!description) return null;

  // Words/phrases that are NOT company names
  const blacklist = [
    'notre', 'nous', 'votre', 'une', 'des', 'les', 'dans', 'pour', 'avec',
    'vous', 'missions', 'profil', 'poste', 'contrat', 'salaire', 'avantages',
    'descriptif', 'candidat', 'offre', 'emploi', 'responsabilités',
    'description', 'garantir', 'valoriser', 'sécuriser', 'contribuer',
    'construire', 'piloter', 'évaluer', 'accompagner', 'développement',
    'pourquoi', 'qui', 'véritable', 'expertise', 'mon', 'le', 'la',
    'rh', 'esn', 'dont',
    // Prepositions & articles (prevent "à travers la vente" etc.)
    'à', 'au', 'en', 'par', 'sur', 'sous', 'vers', 'entre', 'après',
    'avant', 'sans', 'contre', 'depuis', 'cette', 'ces', 'tout',
    'ses', 'son', 'sa', 'leurs', 'leur', 'chaque',
    // Common verbs that start sentences
    'travers', 'vente', 'recherche', 'activité', 'activite',
    // Verbes/participes qui démarrent des phrases de description
    'rattaché', 'rattachée', 'basé', 'basée', 'doté', 'dotée',
    'intégré', 'intégrée', 'situé', 'située',
    'assurer', 'gérer', 'mener', 'négocier', 'déployer', 'travailler',
    'développer', 'piloter', 'garantir', 'fidéliser', 'prospecter',
    'afin', 'prêt', 'prête', 'si', 'chef', 'filiale',
    'parcours', 'package', 'un', 'travailler',
    'de', 'le/la', 'mener',
  ];

  // City names that get extracted as companies
  const cities = [
    'paris', 'lyon', 'marseille', 'toulouse', 'bordeaux', 'lille', 'nantes',
    'strasbourg', 'rennes', 'grenoble', 'rouen', 'dijon', 'reims', 'laon',
    'bethune', 'caen', 'angers', 'tours', 'metz', 'montpellier', 'nice',
    'clermont-ferrand', 'aix-en-provence', 'saint-etienne', 'toulon', 'pau',
    'perpignan', 'limoges', 'amiens', 'orleans', 'besancon', 'mulhouse',
    'brest', 'nancy', 'poitiers', 'avignon', 'valence', 'dunkerque', 'colmar',
    'le mans', 'le havre', 'saint-nazaire', 'troyes', 'lorient', 'bayonne',
    'chambery', 'annecy', 'belfort', 'quimper', 'vannes', 'saint-brieuc', 'aubagne',
    // Belgian & Swiss cities
    'bruxelles', 'liege', 'namur', 'charleroi', 'mons', 'geneve', 'lausanne',
    'fribourg', 'neuchatel', 'sion',
  ];

  function isValid(name: string): boolean {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 3 || clean.length > 50) return false;
    const firstWord = clean.split(' ')[0].toLowerCase();
    if (blacklist.includes(firstWord)) return false;
    if (cities.includes(clean.toLowerCase())) return false;
    // Must start with uppercase or be all caps (company names)
    // Use JS comparison instead of regex range (À-Ÿ includes lowercase accented chars)
    const firstChar = clean.charAt(0);
    if (firstChar !== firstChar.toUpperCase() && clean !== clean.toUpperCase()) return false;
    // Reject prepositional phrases (never company names)
    if (/^(à|au|en|par|pour|dans|sous|sur|avec|sans|vers|chez|entre|contre|après|avant|depuis)\s/i.test(clean)) return false;
    // Reject phrases that look like sentence fragments
    if (/\b(du|de|le|la|les|des|et|ou|en|au|ce|se|si|un|une|son|sa|ses|pas|par|sur|que|qui|est|dans|pour|avec|tout|d'|l')\s*$/i.test(clean)) return false;
    if (/^(À propos|Description|Dans le cadre|Le directeur|Le spécialiste|Dont le|L'objectif|En tant que|Pour le compte)/i.test(clean)) return false;
    if (looksLikeJobTitleFragment(clean)) return false;
    return true;
  }

  const patterns = [
    // "Rejoignez X" / "Bienvenue chez X" / "Rejoins X"
    /(?:Bienvenue chez|Rejoignez|Rejoins|Intégrez)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,!;]|\s+(?:qui|est|et|en|pour|notre|vous|dans)\b)/,
    // "X recrute" / "X recherche" / "X commercialise"
    /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)\s+(?:recrute|recherche|commercialise|développe|renforce|propose|est une|est un|c'est)/m,
    // ALL CAPS company: "BIONATURE recrute" / "EBA s'est"
    /\b([A-Z][A-Z0-9\s&'./-]{1,30}?)\s+(?:recrute|recherche|est |s'est|développe|commercialise|renforce)/,
    // "Au sein de X" / "Au sein d'X"
    /(?:Au sein (?:de |d'))([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:en|vous|nous|et|dans)\b)/,
    // "L'entreprise X" / "La société X" / "Le groupe X" / "La maison X"
    /(?:L'entreprise|La société|Le [Gg]roupe|La maison|Notre société|Notre groupe)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:est|recherche|recrute|vous|basé)\b)/,
    // "pour le compte de X"
    /(?:pour le compte de)\s+(?:(?:son|notre|leur)\s+(?:client\s+)?)?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:un|une|des|nous|qui)\b)/i,
    // "Chez X" (beginning of sentence)
    /(?:^|\.\s+)Chez\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:nous|vous|on|les|la|le)\b)/,
    // "X, leader / spécialiste / expert / acteur"
    /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?),\s+(?:leader|spécialiste|expert|acteur|filiale|groupe|entreprise)/m,
    // "agence/équipe X de [ville]" → X is the company
    /(?:l'agence|l'équipe|la filiale|la branche)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)\s+(?:de|du|des|à)\b/,
    // "les prestations X" / "l'offre du groupe X" / "l'offre X"
    /(?:les prestations|l'offre du groupe|l'offre de)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)(?:\s*[.,;]|\s+(?:et|ou|vous|pour)\b)/,
    // "À propos de X" (Brave Search artifact)
    /À propos de\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)(?:\s+[A-ZÀ-Ÿ]|\s*$)/,
    // "filiale du groupe X" / "marque du groupe X"
    /(?:filiale|marque|enseigne)\s+(?:du groupe\s+)?([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)(?:\s*[.,;]|\s+(?:est|qui|vous|et)\b)/,
    // "X c'est" / "X est"
    /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)\s+(?:c'est|est\s+(?:un|une|le|la|spécialisé|leader))/m,
    // "Qui sommes-nous ? X est/," — very common FR pattern
    /Qui sommes[- ]nous\s*\??\s*\n?\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:est|c'est|recrute|recherche|,)\b)/,
    // "Fondée en 2005, X" / "Créée en 2010, X" / "Depuis 2003, X"
    /(?:Fondée?|Créée?|Depuis)\s+en\s+\d{4}\s*,\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;]|\s+(?:est|a|développe|propose)\b)/,
    // "Présentation :\n X" / "Présentation de X"
    /Présentation\s*(?:de\s+|:\s*\n?\s*)([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,45}?)(?:\s*[.,;:\n]|\s+(?:est|,)\b)/,
    // "X (ville)" or "X - ville" at start of description
    /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?)\s*(?:\(|[-–—]\s*(?:basée?|située?|implantée?))/m,
    // "Société X" / "Entreprise X" without article
    /(?:^|\n)\s*(?:Société|Entreprise)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,40}?)(?:\s*[.,;]|\s+(?:est|recherche|recrute|basée?)\b)/,
    // "X, acteur majeur / société spécialisée / PME"
    /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9\s&'./-]{2,35}?),\s+(?:acteur|société|PME|ETI|start-up|startup|cabinet|agence)/m,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1] && isValid(match[1])) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }
  return null;
}

function mapOfferToSignal(offer: FranceTravailOffer): ScrapedSignal {
  const rawContent = sanitizeScrapedContent(
    [
      offer.intitule,
      offer.entreprise?.nom,
      offer.lieuTravail?.libelle,
      offer.description,
    ]
      .filter(Boolean)
      .join(' ')
  );

  // Try to extract company from description if not provided.
  // Note: on filtre aussi l'`entreprise.nom` direct car France Travail peut renvoyer
  // un nom pourri (ex: copie du libelle de l'offre) dans certaines offres anonymisees.
  const directName = offer.entreprise?.nom?.trim();
  const cleanDirect = directName && !looksLikeJobTitleFragment(directName) ? directName : null;
  let companyName = cleanDirect || extractCompanyFromDescription(offer.description);

  // Clean up extracted company name
  if (companyName) {
    // "À propos de Rothelec Rothelec" → "Rothelec"
    companyName = companyName.replace(/^À propos de\s+/i, '');
    // "Rejoindre le Groupe Thivolle" → "Groupe Thivolle"
    companyName = companyName.replace(/^Rejoindre\s+(?:le |la |l')/i, '');
    // "L'agence POINT.P de Viuz" → "POINT.P"
    const agencyMatch = companyName.match(/^L'(?:agence|équipe)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9.&-]+)/);
    if (agencyMatch) companyName = agencyMatch[1];
    // "Salade 2 Fruits voit le jour" → "Salade 2 Fruits"
    companyName = companyName.replace(/\s+(?:voit le jour|est |qui |a été).*$/i, '');
    // Remove trailing garbage words
    companyName = companyName.replace(/\s+(?:de|du|des|le|la|les|et|en|au|afin|dans)$/i, '').trim();
    // Deduplicate "Rothelec Rothelec" → "Rothelec"
    const words = companyName.split(/\s+/);
    if (words.length === 2 && words[0].toLowerCase() === words[1].toLowerCase()) companyName = words[0];
    // Final validation
    if (companyName.length < 2) companyName = null;
  }

  return {
    signal_type: 'job_posting',
    source: 'france_travail',
    source_url: `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    raw_content: rawContent,
    extracted_data: {
      job_title: offer.intitule,
      company_name: companyName,
      location: offer.lieuTravail?.libelle,
      description: offer.description,
      contact_name: offer.contact?.nom,
      contact_email: offer.contact?.courriel,
      posted_date: offer.dateCreation,
      salary: offer.salaire?.libelle,
      contract_type: offer.typeContrat,
      experience_required: offer.experienceExige,
    },
  };
}

export const franceTravailScraper: Scraper = {
  name: 'france_travail',

  async fetch(keywords: string[], opts: { location?: string; credentials: Record<string, string> }): Promise<ScraperResult> {
    const startTime = Date.now();
    const signals: ScrapedSignal[] = [];
    const errors: string[] = [];

    const clientId = opts.credentials.client_id;
    const clientSecret = opts.credentials.client_secret;
    if (!clientId || !clientSecret) {
      return { signals: [], errors: ['FRANCE_TRAVAIL_CLIENT_ID or FRANCE_TRAVAIL_CLIENT_SECRET not configured'], duration_ms: 0 };
    }

    try {
      // Limit to top 15 keywords to avoid resource exhaustion
      for (const keyword of keywords.slice(0, 15)) {
        try {
          const offers = await searchOffers(keyword, clientId, clientSecret, opts.location);
          for (const offer of offers) {
            signals.push(mapOfferToSignal(offer));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Error searching keyword "${keyword}": ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`France Travail scraper error: ${message}`);
    }

    return {
      signals,
      errors,
      duration_ms: Date.now() - startTime,
    };
  },
};

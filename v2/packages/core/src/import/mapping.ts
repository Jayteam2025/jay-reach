/**
 * Mapping automatique des colonnes vers les champs canoniques, multilingue
 * (FR / EN / NL). Une colonne non reconnue est ignorée, jamais devinée.
 */

export const IMPORT_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'job_title',
  'company',
  'linkedin_url',
  'phone',
  'city',
  'postal_code',
  'country',
  'siren',
  'website',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  first_name: ['first name', 'firstname', 'prenom', 'voornaam', 'given name'],
  last_name: ['last name', 'lastname', 'surname', 'nom', 'nom de famille', 'achternaam'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'e-mailadres'],
  job_title: ['job title', 'title', 'poste', 'fonction', 'intitule', 'functie'],
  company: ['company', 'entreprise', 'societe', 'organisation', 'bedrijf', 'company name'],
  linkedin_url: ['linkedin', 'linkedin url', 'profil linkedin', 'linkedin profile'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'telefoon', 'phone number'],
  city: ['city', 'ville', 'stad', 'localite'],
  postal_code: ['postal code', 'zip', 'code postal', 'cp', 'postcode'],
  country: ['country', 'pays', 'land'],
  siren: ['siren', 'siret'],
  website: ['website', 'site', 'site web', 'url', 'webseite', 'domaine'],
};

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type ColumnMapping = Record<string, ImportField>;

/** Propose un mapping en-tête → champ canonique (par correspondance floue). */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ImportField>();
  for (const header of headers) {
    const norm = normalizeHeader(header);
    let match: ImportField | undefined;
    for (const field of IMPORT_FIELDS) {
      if (used.has(field)) {
        continue;
      }
      if (SYNONYMS[field].some((syn) => normalizeHeader(syn) === norm) || norm === field.replace('_', ' ')) {
        match = field;
        break;
      }
    }
    if (match) {
      mapping[header] = match;
      used.add(match);
    }
  }
  return mapping;
}

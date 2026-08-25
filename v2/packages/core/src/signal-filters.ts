/**
 * Filtres de signaux (offres d'emploi) : exclusion des cabinets de recrutement
 * et déduplication multi-agrégateurs. Connaissance extraite du legacy (T0,
 * `docs/legacy-assets/signaux-scrapers.md`) — purs et testables.
 */

/** Codes NAF des activités de recrutement / intérim / placement (division 78). */
export const RECRUITMENT_NAF_CODES = ['78.10Z', '78.20Z', '78.30Z'] as const;

/** Normalise un code NAF : `7810Z` → `78.10Z`. */
export function normalizeNaf(code: string): string {
  const cleaned = code.replace(/\./g, '').toUpperCase().trim();
  const m = cleaned.match(/^(\d{2})(\d{2})([A-Z])$/);
  return m ? `${m[1]}.${m[2]}${m[3]}` : cleaned;
}

export function isRecruitmentByNaf(naf: string | undefined | null): boolean {
  if (!naf) {
    return false;
  }
  return (RECRUITMENT_NAF_CODES as readonly string[]).includes(normalizeNaf(naf));
}

const RECRUITMENT_NAME_RE =
  /\b(recrutement|recruiting|int[eé]rim|staffing|placement|headhunt|chasseur de t[eê]tes|cabinet (conseil|rh|recrutement)|conseil (en )?recrutement|executive search|talent (strategy|acquisition))\b/i;

// Extrait de la blacklist legacy (cabinets + job boards), en minuscules.
const RECRUITMENT_BLACKLIST = [
  'adecco', 'manpower', 'randstad', 'hays', 'michael page', 'page personnel', 'robert half',
  'expectra', 'synergie', 'crit', 'actual', 'temporis', 'proman', 'artus', 'supplay',
  'kelly services', 'gi group', 'adéquat', 'adequat', 'samsic', 'uptoo', 'fed', 'akkodis',
  'robert walters', 'menway', 'abalone', 'ergalis',
  'indeed', 'monster', 'hellowork', 'meteojob', 'keljob', 'regionsjob', 'talent.com',
];

export function isRecruitmentByName(name: string): boolean {
  if (RECRUITMENT_NAME_RE.test(name)) {
    return true;
  }
  const lower = name.toLowerCase();
  return RECRUITMENT_BLACKLIST.some((entry) => lower.includes(entry));
}

/** Un signal doit-il être écarté parce qu'il vient d'un cabinet/intérim ? */
export function isRecruitmentAgency(input: { name?: string; naf?: string | null }): boolean {
  return isRecruitmentByNaf(input.naf) || (input.name ? isRecruitmentByName(input.name) : false);
}

export interface FingerprintInput {
  readonly company: string;
  readonly title: string;
  readonly postalCode?: string;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Empreinte de déduplication : entreprise + intitulé + code postal, normalisés. */
export function signalFingerprint(input: FingerprintInput): string {
  return [normalizeText(input.company), normalizeText(input.title), (input.postalCode ?? '').trim()].join('|');
}

/** Déduplique une même offre publiée sur plusieurs agrégateurs. */
export function dedupeByFingerprint<T extends FingerprintInput>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const fp = signalFingerprint(item);
    if (!seen.has(fp)) {
      seen.add(fp);
      out.push(item);
    }
  }
  return out;
}

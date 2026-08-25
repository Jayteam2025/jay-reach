/**
 * Ciblage sectoriel par code NAF / NACE.
 *
 * La NAF est la declinaison francaise de la NACE europeenne : les 4 premiers
 * caracteres sont communs (`62.01`), la lettre finale est une subdivision
 * nationale (`62.01Z`). Filtrer en NAF revient donc a filtrer en NACE avec un
 * cran de granularite en plus.
 *
 * Un filtre (`signal_triggers.industry_filters`) est une liste d'entrees
 * heterogenes, tolerante a la saisie :
 *   - sous-classe        `62.01Z`, `6201Z`, `62.01 z`
 *   - prefixe            `62` (division), `62.0` (groupe), `62.01` (classe)
 *   - section            `J`
 *   - mot-cle libre      `distribution` — retrocompatibilite avec la saisie
 *                        texte historique du champ "Secteurs cibles"
 *
 * Le verdict est volontairement a trois etats : sans code NAF resolu, on ne
 * tranche pas (`unknown`). Eliminer un signal sur un code absent ou mal
 * resolu couterait des prospects valides.
 */

import { NAF_DIVISIONS, NAF_SECTIONS, NAF_SUBCLASSES } from './naf-codes.js';

export type NafVerdict = 'match' | 'mismatch' | 'unknown';

export interface NafFilter {
  /** Prefixes de codes, forme canonique pointee (`62`, `62.0`, `62.01Z`). */
  codes: string[];
  /** Lettres de sections (`J`, `C`). */
  sections: string[];
  /** Mots-cles libres, normalises (sans accent, minuscules). */
  keywords: string[];
  isEmpty: boolean;
}

export interface NafCandidate {
  /** Code APE de l'entreprise, si connu. */
  nafCode?: string | null;
  /** Libelle sectoriel deja connu (FullEnrich, France Travail...). */
  sectorLabel?: string | null;
  /** Texte additionnel ou chercher les mots-cles (contenu de l'offre...). */
  haystack?: string | null;
}

/** Retire accents / casse / ponctuation faible pour comparer des libelles. */
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Met un code (ou un prefixe de code) sous forme canonique pointee.
 * `6201Z` -> `62.01Z`, `620` -> `62.0`, `62` -> `62`.
 * Retourne null si l'entree n'est pas un code NAF plausible.
 */
export function normalizeNafCode(input: string): string | null {
  const compact = input.replace(/[\s.\-_/]/g, '').toUpperCase();
  const parsed = /^(\d{2})(\d{0,2})([A-Z]?)$/.exec(compact);
  if (!parsed) return null;

  const division = parsed[1] ?? '';
  const rest = parsed[2] ?? '';
  const letter = parsed[3] ?? '';
  // Une lettre ne qualifie une activite qu'au niveau sous-classe (4 chiffres).
  if (letter && rest.length !== 2) return null;

  let code = division;
  if (rest.length >= 1) code += `.${rest.slice(0, 1)}`;
  if (rest.length === 2) code += rest.slice(1);
  return `${code}${letter}`;
}

/** Section NACE (`A`..`U`) d'un code ou d'une division. `null` si inconnue. */
export function nafSection(code: string | null | undefined): string | null {
  if (!code) return null;
  const division = Number(code.slice(0, 2));
  if (!Number.isInteger(division)) return null;
  for (const [letter, range] of Object.entries(NAF_SECTIONS)) {
    if (division >= range.from && division <= range.to) return letter;
  }
  return null;
}

/**
 * Libelle lisible d'un code : sous-classe, division ou section.
 * Les niveaux intermediaires (groupe `62.0`, classe `62.01`) retombent sur le
 * libelle de leur division — suffisant pour de l'affichage.
 */
export function nafLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  const section = NAF_SECTIONS[upper];
  if (section) return section.label;

  const normalized = normalizeNafCode(upper);
  if (!normalized) return null;
  return NAF_SUBCLASSES[normalized] ?? NAF_DIVISIONS[normalized.slice(0, 2)] ?? null;
}

/** `62.01Z` -> `62.01Z — Programmation informatique`. */
export function formatNaf(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = normalizeNafCode(code) ?? code.toUpperCase();
  const label = nafLabel(normalized);
  return label ? `${normalized} — ${label}` : normalized;
}

/** true si le code est une sous-classe NAF rev. 2 existante. */
export function isKnownNafSubclass(code: string | null | undefined): boolean {
  if (!code) return false;
  const normalized = normalizeNafCode(code);
  return !!normalized && normalized in NAF_SUBCLASSES;
}

/** Decompose les entrees brutes d'`industry_filters` en criteres exploitables. */
export function parseNafFilter(raw: readonly string[] | null | undefined): NafFilter {
  const codes: string[] = [];
  const sections: string[] = [];
  const keywords: string[] = [];

  for (const entry of raw ?? []) {
    const trimmed = (entry ?? '').trim();
    if (!trimmed) continue;

    if (/^[A-U]$/i.test(trimmed)) {
      const letter = trimmed.toUpperCase();
      if (!sections.includes(letter)) sections.push(letter);
      continue;
    }

    const code = normalizeNafCode(trimmed);
    if (code) {
      if (!codes.includes(code)) codes.push(code);
      continue;
    }

    const keyword = normalizeText(trimmed);
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
  }

  return {
    codes,
    sections,
    keywords,
    isEmpty: codes.length === 0 && sections.length === 0 && keywords.length === 0,
  };
}

/**
 * Confronte un candidat au filtre.
 *
 * `unknown` = non concluant : aucun critere n'a pu etre evalue (pas de code
 * resolu, pas de texte a fouiller). L'appelant doit alors conserver le signal.
 */
export function matchNafFilter(filter: NafFilter, candidate: NafCandidate): NafVerdict {
  if (filter.isEmpty) return 'match';

  const code = candidate.nafCode ? normalizeNafCode(candidate.nafCode) : null;
  const hasCodeCriteria = filter.codes.length > 0 || filter.sections.length > 0;

  if (code && hasCodeCriteria) {
    if (filter.codes.some((prefix) => code.startsWith(prefix))) return 'match';
    const section = nafSection(code);
    if (section && filter.sections.includes(section)) return 'match';
  }

  const haystack = normalizeText(
    [candidate.sectorLabel, nafLabel(code), candidate.haystack].filter(Boolean).join(' '),
  );
  if (filter.keywords.length > 0 && haystack) {
    if (filter.keywords.some((keyword) => haystack.includes(keyword))) return 'match';
  }

  // Rien n'a matche : on ne conclut au rejet que si au moins un critere etait
  // reellement evaluable.
  const codeCriteriaEvaluated = hasCodeCriteria && !!code;
  const keywordCriteriaEvaluated = filter.keywords.length > 0 && !!haystack;
  if (codeCriteriaEvaluated || keywordCriteriaEvaluated) return 'mismatch';
  return 'unknown';
}

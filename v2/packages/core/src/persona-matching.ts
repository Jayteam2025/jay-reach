/**
 * Correspondance persona ↔ intitulé de poste (multilingue). Un intitulé peut
 * matcher plusieurs personas → arbitrage humain. Pur et testable.
 */

export interface PersonaRule {
  readonly id: string;
  /** Intitulés déclencheurs, multilingues (ex. « directeur commercial », « sales director »). */
  readonly titlePatterns: readonly string[];
  readonly titleExclusions?: readonly string[];
}

export type PersonaMatchStatus = 'matched' | 'ambiguous' | 'none';

export interface PersonaMatchResult {
  readonly status: PersonaMatchStatus;
  readonly personaId?: string;
  readonly candidates: string[];
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchPersona(
  jobTitle: string,
  personas: readonly PersonaRule[],
): PersonaMatchResult {
  const title = normalize(jobTitle);
  const candidates: string[] = [];

  for (const persona of personas) {
    const excluded = (persona.titleExclusions ?? []).some((ex) => title.includes(normalize(ex)));
    if (excluded) {
      continue;
    }
    const matches = persona.titlePatterns.some((pattern) => {
      const p = normalize(pattern);
      return p.length > 0 && title.includes(p);
    });
    if (matches) {
      candidates.push(persona.id);
    }
  }

  if (candidates.length === 1) {
    return { status: 'matched', personaId: candidates[0], candidates };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidates };
  }
  return { status: 'none', candidates };
}

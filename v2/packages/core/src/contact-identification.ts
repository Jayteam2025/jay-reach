/**
 * Identification des contacts : depuis un compte enrichi, rattacher chaque
 * personne à un persona (par intitulé, multilingue) et calculer sa langue.
 * Pur — la découverte des personnes (enrichissement) est faite en amont.
 */
import { matchPersona, type PersonaRule } from './persona-matching.js';
import { computeLocale, type ContactLocale, type LocaleInput } from './contact-locale.js';

export interface CandidatePerson extends LocaleInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly jobTitle: string;
}

export interface IdentifiedContact {
  readonly person: CandidatePerson;
  readonly personaId: string;
  readonly locale: ContactLocale;
}

export interface AmbiguousContact {
  readonly person: CandidatePerson;
  readonly candidates: string[];
}

export interface IdentificationResult {
  readonly identified: IdentifiedContact[];
  readonly ambiguous: AmbiguousContact[];
  readonly unmatched: CandidatePerson[];
}

export function identifyContacts(
  people: readonly CandidatePerson[],
  personas: readonly PersonaRule[],
): IdentificationResult {
  const identified: IdentifiedContact[] = [];
  const ambiguous: AmbiguousContact[] = [];
  const unmatched: CandidatePerson[] = [];

  for (const person of people) {
    const match = matchPersona(person.jobTitle, personas);
    if (match.status === 'matched' && match.personaId) {
      identified.push({ person, personaId: match.personaId, locale: computeLocale(person) });
    } else if (match.status === 'ambiguous') {
      ambiguous.push({ person, candidates: match.candidates });
    } else {
      unmatched.push(person);
    }
  }

  return { identified, ambiguous, unmatched };
}

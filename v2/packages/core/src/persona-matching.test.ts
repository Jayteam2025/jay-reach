import { describe, expect, it } from 'vitest';
import { matchPersona, type PersonaRule } from './persona-matching.js';

const DIRCO: PersonaRule = {
  id: 'dirco',
  titlePatterns: ['directeur commercial', 'sales director', 'commercieel directeur', 'head of sales'],
  titleExclusions: ['assistant', 'adjoint'],
};
const MARKETING: PersonaRule = {
  id: 'mkt',
  titlePatterns: ['directeur marketing', 'head of marketing'],
};

describe('matchPersona', () => {
  it('matche un intitulé FR', () => {
    expect(matchPersona('Directeur Commercial', [DIRCO])).toMatchObject({ status: 'matched', personaId: 'dirco' });
  });

  it('matche un intitulé EN et NL', () => {
    expect(matchPersona('Sales Director', [DIRCO]).personaId).toBe('dirco');
    expect(matchPersona('Commercieel Directeur', [DIRCO]).personaId).toBe('dirco');
  });

  it('exclut via titleExclusions', () => {
    expect(matchPersona('Assistant Sales Director', [DIRCO]).status).toBe('none');
  });

  it('signale une ambiguïté quand plusieurs personas matchent', () => {
    const both: PersonaRule = { id: 'both', titlePatterns: ['directeur'] };
    const r = matchPersona('Directeur Commercial et Marketing', [both, MARKETING, DIRCO]);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it('aucun match', () => {
    expect(matchPersona('Développeur Backend', [DIRCO, MARKETING]).status).toBe('none');
  });
});

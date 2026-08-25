import { describe, expect, it } from 'vitest';
import { computeLocale } from './contact-locale.js';
import { identifyContacts } from './contact-identification.js';
import type { PersonaRule } from './persona-matching.js';

describe('computeLocale', () => {
  it('France → fr, Pays-Bas → nl', () => {
    expect(computeLocale({ country: 'FR' })).toBe('fr');
    expect(computeLocale({ country: 'Netherlands' })).toBe('nl');
  });

  it('Belgique : Flandre → nl, Wallonie/Bruxelles → fr', () => {
    expect(computeLocale({ country: 'BE', city: 'Antwerpen' })).toBe('nl');
    expect(computeLocale({ country: 'BE', region: 'Vlaanderen' })).toBe('nl');
    expect(computeLocale({ country: 'BE', city: 'Liège' })).toBe('fr');
    expect(computeLocale({ country: 'BE', city: 'Bruxelles' })).toBe('fr');
    expect(computeLocale({ country: 'BE' })).toBe('fr');
  });

  it('autre pays → en', () => {
    expect(computeLocale({ country: 'US' })).toBe('en');
  });
});

const PERSONAS: PersonaRule[] = [
  { id: 'dirco', titlePatterns: ['directeur commercial', 'sales director', 'commercieel directeur'] },
  { id: 'mkt', titlePatterns: ['directeur marketing'] },
];

describe('identifyContacts', () => {
  it('rattache un contact à son persona avec sa langue', () => {
    const res = identifyContacts([{ jobTitle: 'Sales Director', country: 'FR' }], PERSONAS);
    expect(res.identified).toHaveLength(1);
    expect(res.identified[0]).toMatchObject({ personaId: 'dirco', locale: 'fr' });
  });

  it('calcule la langue belge par région', () => {
    const res = identifyContacts([{ jobTitle: 'Commercieel Directeur', country: 'BE', city: 'Gent' }], PERSONAS);
    expect(res.identified[0]?.locale).toBe('nl');
  });

  it('sépare ambigus et non rattachés', () => {
    const both: PersonaRule[] = [
      { id: 'a', titlePatterns: ['directeur'] },
      { id: 'b', titlePatterns: ['commercial'] },
    ];
    const res = identifyContacts(
      [{ jobTitle: 'Directeur Commercial' }, { jobTitle: 'Développeur' }],
      both,
    );
    expect(res.ambiguous).toHaveLength(1);
    expect(res.unmatched).toHaveLength(1);
  });
});

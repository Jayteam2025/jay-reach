import { describe, expect, it } from 'vitest';
import { normalizeAdzuna, normalizeFranceTravail } from './signal-jobboard.js';
import { dedupeByFingerprint, isRecruitmentAgency, normalizeNaf } from './signal-filters.js';

// Fixtures synthétiques — aucune vraie entreprise ni personne (règle CLAUDE.md).
const FT = {
  id: 'X1',
  intitule: 'Commercial itinérant H/F',
  entreprise: { nom: 'Société Témoin' },
  lieuTravail: { libelle: 'Lyon', codePostal: '69003' },
  dateCreation: '2026-08-10T09:00:00Z',
  codeNAF: '4690Z',
};
const ADZ = {
  id: 'Y2',
  title: 'Business Developer',
  company: { display_name: 'Entreprise Alpha' },
  location: { display_name: 'Paris' },
  created: '2026-08-11T10:00:00Z',
  redirect_url: 'https://example.test/job/Y2',
};

describe('normalisation jobboard', () => {
  it('France Travail → JobSignal', () => {
    const s = normalizeFranceTravail(FT);
    expect(s).toMatchObject({
      source: 'francetravail',
      kind: 'job_posting',
      company: 'Société Témoin',
      postalCode: '69003',
      naf: '4690Z',
    });
    expect(s.externalId).toBe('ft:X1');
  });

  it('Adzuna → JobSignal', () => {
    const s = normalizeAdzuna(ADZ);
    expect(s).toMatchObject({
      source: 'adzuna',
      company: 'Entreprise Alpha',
      url: 'https://example.test/job/Y2',
    });
  });
});

describe('exclusion cabinets + déduplication', () => {
  it('normalise le code NAF', () => {
    expect(normalizeNaf('7810Z')).toBe('78.10Z');
  });

  it('exclut par code NAF (division 78) mais pas un vrai employeur', () => {
    expect(isRecruitmentAgency({ naf: '7810Z' })).toBe(true);
    expect(isRecruitmentAgency({ naf: '4690Z' })).toBe(false);
  });

  it('exclut par nom (blacklist + regex), garde un vrai employeur', () => {
    expect(isRecruitmentAgency({ name: 'Adecco France' })).toBe(true);
    expect(isRecruitmentAgency({ name: 'Cabinet de recrutement Durand' })).toBe(true);
    expect(isRecruitmentAgency({ name: 'Boulangerie Martin' })).toBe(false);
  });

  it('déduplique la même offre publiée sur plusieurs agrégateurs', () => {
    const items = [
      { company: 'Société Témoin', title: 'Commercial itinérant', postalCode: '69003' },
      { company: 'SOCIÉTÉ TÉMOIN', title: 'commercial itinérant', postalCode: '69003' },
      { company: 'Entreprise Alpha', title: 'Business Developer', postalCode: '75001' },
    ];
    expect(dedupeByFingerprint(items)).toHaveLength(2);
  });
});

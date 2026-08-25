import { describe, it, expect } from 'vitest';
import {
  normalizeAgencyName,
  isRecruitmentByName,
  isRecruitmentByNaf,
  isRecruitmentAgency,
} from './signal-filters.js';

describe('normalizeAgencyName — parité avec la fonction SQL', () => {
  it('produit les mêmes clés que public.normalize_agency_name en base', () => {
    // Valeurs vérifiées sur le projet hébergé (SELECT name_normalized ...).
    expect(normalizeAgencyName('Adecco')).toBe('adecco');
    expect(normalizeAgencyName("Mercato de l'Emploi")).toBe('mercatodelemploi');
    expect(normalizeAgencyName("Orient'Action")).toBe('orientaction');
  });

  it('retire accents, espaces, tirets et apostrophes', () => {
    expect(normalizeAgencyName('Adéquat')).toBe('adequat');
    expect(normalizeAgencyName('Gi Group')).toBe('gigroup');
    expect(normalizeAgencyName('Job-Link')).toBe('joblink');
    expect(normalizeAgencyName('')).toBe('');
  });
});

describe('isRecruitmentByName', () => {
  it('détecte via le motif générique (sans blacklist)', () => {
    expect(isRecruitmentByName('Cabinet Durand Recrutement')).toBe(true);
    expect(isRecruitmentByName('Executive Search Partners')).toBe(true);
    expect(isRecruitmentByName('Agence Intérim Sud')).toBe(true);
  });

  it('détecte via le repli intégré', () => {
    expect(isRecruitmentByName('Adecco France')).toBe(true);
  });

  it('détecte via la blacklist DB passée en argument (noms normalisés)', () => {
    const bl = new Set([normalizeAgencyName('WIZBII'), normalizeAgencyName("Orient'Action")]);
    expect(isRecruitmentByName('WIZBII', bl)).toBe(true);
    expect(isRecruitmentByName('orient action', bl)).toBe(true); // normalisé pareil
  });

  it("n'écarte pas une vraie entreprise absente des listes", () => {
    expect(isRecruitmentByName('Boulangerie Martin')).toBe(false);
    expect(isRecruitmentByName('Boulangerie Martin', new Set(['wizbii']))).toBe(false);
  });
});

describe('isRecruitmentByNaf', () => {
  it('écarte la division 78 (recrutement/intérim/placement)', () => {
    expect(isRecruitmentByNaf('7810Z')).toBe(true);
    expect(isRecruitmentByNaf('78.20Z')).toBe(true);
    expect(isRecruitmentByNaf('7830Z')).toBe(true);
  });
  it('laisse passer les autres NAF', () => {
    expect(isRecruitmentByNaf('6201Z')).toBe(false);
    expect(isRecruitmentByNaf(null)).toBe(false);
  });
});

describe('isRecruitmentAgency — combine NAF + nom + blacklist', () => {
  it('écarte par NAF même si le nom est neutre', () => {
    expect(isRecruitmentAgency({ name: 'Groupe Alpha', naf: '7820Z' })).toBe(true);
  });
  it('écarte par blacklist DB', () => {
    const bl = new Set([normalizeAgencyName('Talenteeds')]);
    expect(isRecruitmentAgency({ name: 'Talenteeds', naf: '6201Z' }, bl)).toBe(true);
  });
  it('laisse passer un vrai prospect', () => {
    expect(isRecruitmentAgency({ name: 'Menuiserie du Bocage', naf: '1623Z' })).toBe(false);
  });
});

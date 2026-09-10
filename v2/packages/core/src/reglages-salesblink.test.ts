import { describe, expect, it } from 'vitest';
import { normaliserDelaiRelanceMax, normaliserIntervalleReleve } from './reglages-salesblink.js';

describe('normaliserIntervalleReleve', () => {
  it('rend 5 minutes quand rien n est regle', () => {
    expect(normaliserIntervalleReleve(undefined)).toBe(5);
    expect(normaliserIntervalleReleve(null)).toBe(5);
    expect(normaliserIntervalleReleve('')).toBe(5);
    expect(normaliserIntervalleReleve('abc')).toBe(5);
  });
  it('borne entre 2 et 60 minutes et tronque a l entier', () => {
    expect(normaliserIntervalleReleve('1')).toBe(2);
    expect(normaliserIntervalleReleve('0')).toBe(2);
    expect(normaliserIntervalleReleve('7.9')).toBe(7);
    expect(normaliserIntervalleReleve('600')).toBe(60);
  });
});

describe('normaliserDelaiRelanceMax', () => {
  it('rend 6 heures par defaut et borne entre 1 et 72', () => {
    expect(normaliserDelaiRelanceMax(undefined)).toBe(6);
    expect(normaliserDelaiRelanceMax('0')).toBe(1);
    expect(normaliserDelaiRelanceMax('100')).toBe(72);
    expect(normaliserDelaiRelanceMax('12')).toBe(12);
  });
});

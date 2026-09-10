import { describe, expect, it } from 'vitest';
import { placesRestantes, reduireLotAuReste } from './plafonds.js';

describe('placesRestantes', () => {
  it('rend le reste quand le plafond est positif', () => {
    expect(placesRestantes(300, 120)).toBe(180);
  });
  it('rend zero quand le plafond est atteint ou depasse', () => {
    expect(placesRestantes(300, 300)).toBe(0);
    expect(placesRestantes(300, 350)).toBe(0);
  });
  it('rend zero quand le plafond vaut zero (pause) ou est invalide', () => {
    expect(placesRestantes(0, 0)).toBe(0);
    expect(placesRestantes(Number.NaN, 0)).toBe(0);
    expect(placesRestantes(-5, 0)).toBe(0);
  });
});

describe('reduireLotAuReste', () => {
  it('garde le lot entier quand le reste suffit', () => {
    expect(reduireLotAuReste(50, 180)).toBe(50);
  });
  it('reduit le lot au reste', () => {
    expect(reduireLotAuReste(50, 7)).toBe(7);
  });
  it('rend zero sans reste', () => {
    expect(reduireLotAuReste(50, 0)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { relectureRequise } from './relecture.js';

describe('relectureRequise', () => {
  it('seuil 3, deux déjà partis → la troisième passe en relecture', () => {
    expect(relectureRequise({ seuil: 3, dejaPartis: 2 })).toBe(true);
  });

  it('seuil 3, trois déjà partis → la quatrième part directement', () => {
    expect(relectureRequise({ seuil: 3, dejaPartis: 3 })).toBe(false);
  });

  it('seuil 0 → jamais de relecture, quel que soit le nombre déjà parti', () => {
    expect(relectureRequise({ seuil: 0, dejaPartis: 0 })).toBe(false);
    expect(relectureRequise({ seuil: 0, dejaPartis: 5 })).toBe(false);
  });

  it('dejaPartis dépasse le seuil → pas de relecture (jamais négatif à rattraper)', () => {
    expect(relectureRequise({ seuil: 3, dejaPartis: 10 })).toBe(false);
  });
});

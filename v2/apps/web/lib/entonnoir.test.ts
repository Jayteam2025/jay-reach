import { describe, expect, it } from 'vitest';
import { tauxLivresAffiche } from './entonnoir';

const t = (cle: string, valeurs: { n: number }): string => {
  expect(cle).toBe('overview.funnel.awaitingSendSuffix');
  return `· ${valeurs.n} en attente d'envoi`;
};

describe('tauxLivresAffiche (F13, décision du 18/09)', () => {
  it('annote le complément quand il reste des emails en attente d’envoi', () => {
    expect(tauxLivresAffiche('70,7 %', 49, t)).toBe("70,7 % · 49 en attente d'envoi");
  });

  it('n’annote pas quand tout ce qui est engagé est réellement parti (complément nul)', () => {
    expect(tauxLivresAffiche('100 %', 0, t)).toBe('100 %');
  });

  it('n’annote pas non plus pour un complément négatif (défense en profondeur, ne devrait pas arriver)', () => {
    expect(tauxLivresAffiche('100 %', -1, t)).toBe('100 %');
  });
});

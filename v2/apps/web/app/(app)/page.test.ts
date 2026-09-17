import { describe, expect, it } from 'vitest';
import { quandRelatif } from './page';

/**
 * `quandRelatif` (I5, revue finale) : la classification aujourd'hui/hier
 * comparait `toDateString()` — accesseurs locaux, donc le fuseau du PROCESS
 * qui exécute le rendu, pas celui de l'organisation (`FUSEAU_PAR_DEFAUT`,
 * `Europe/Paris`). `maintenant` est un paramètre (jamais `new Date()` lu à
 * l'intérieur) : testable sans horloge, même patron que `dateRelativeCourte`
 * (`lib/dates.ts`).
 */
describe('quandRelatif', () => {
  it('un instant vide rend une chaîne vide', () => {
    expect(quandRelatif(null)).toBe('');
  });

  it('un instant d’aujourd’hui à Paris rend l’heure seule', () => {
    const maintenant = new Date('2026-01-15T10:00:00.000Z');
    expect(quandRelatif('2026-01-15T08:30:00.000Z', maintenant)).toBe('09:30');
  });

  it('frontière de minuit à Paris : « maintenant » à 00:30 Paris (23:30 UTC la veille) reste « aujourd’hui »', () => {
    // 23:30 UTC le 14 janvier = 00:30 à Paris le 15 janvier (CET, UTC+1) : le
    // jour de référence est Paris le 15, pas UTC le 14.
    const maintenant = new Date('2026-01-14T23:30:00.000Z');
    expect(quandRelatif('2026-01-14T23:30:00.000Z', maintenant)).toBe('00:30');
  });

  it('un instant encore « aujourd’hui » en UTC mais déjà « hier » à Paris est classé « hier » (R67)', () => {
    // « Maintenant » (23:30 UTC le 14) est déjà le 15 janvier à Paris. L'instant
    // testé (10:00 UTC le 14 = 11:00 Paris le 14) est le 14 janvier À PARIS
    // COMME EN UTC — un ancien correctif qui comparerait `toDateString()` (jour
    // UTC du process) les trouverait tous deux « le 14 » et rendrait à tort
    // « aujourd'hui » : le jour de référence, lui, est déjà le 15 à Paris.
    const maintenant = new Date('2026-01-14T23:30:00.000Z');
    expect(quandRelatif('2026-01-14T10:00:00.000Z', maintenant)).toBe('hier');
  });

  it('un instant plus ancien rend « il y a N j »', () => {
    const maintenant = new Date('2026-01-15T10:00:00.000Z');
    expect(quandRelatif('2026-01-10T10:00:00.000Z', maintenant)).toBe('il y a 5 j');
  });
});

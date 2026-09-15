import { describe, expect, it } from 'vitest';
import { dateRelativeCourte } from './dates';

describe('dateRelativeCourte', () => {
  const maintenant = new Date('2026-09-15T12:00:00.000Z');

  it('moins d’une heure -> minutes (jamais 0, même à quelques secondes)', () => {
    expect(dateRelativeCourte('2026-09-15T11:45:00.000Z', maintenant)).toBe('il y a 15 min');
    expect(dateRelativeCourte('2026-09-15T11:59:50.000Z', maintenant)).toBe('il y a 1 min');
  });

  it('entre une heure et un jour -> heures', () => {
    expect(dateRelativeCourte('2026-09-15T10:00:00.000Z', maintenant)).toBe('il y a 2 h');
    expect(dateRelativeCourte('2026-09-14T13:00:00.000Z', maintenant)).toBe('il y a 23 h');
  });

  it('entre 24 et 48 h -> « hier »', () => {
    expect(dateRelativeCourte('2026-09-14T12:00:00.000Z', maintenant)).toBe('hier');
    expect(dateRelativeCourte('2026-09-13T13:00:00.000Z', maintenant)).toBe('hier');
  });

  it('au-delà de 48 h -> date courte (jour + mois abrégé)', () => {
    expect(dateRelativeCourte('2026-09-10T13:00:00.000Z', maintenant)).toBe('10 sept.');
  });
});

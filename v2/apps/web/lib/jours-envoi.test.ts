import { describe, expect, it } from 'vitest';
import { libelleJoursEnvoi } from './jours-envoi';

describe('libelleJoursEnvoi', () => {
  it('compacte lundi à vendredi', () => {
    expect(libelleJoursEnvoi([1, 2, 3, 4, 5])).toBe('lundi à vendredi');
  });

  it('compacte les sept jours', () => {
    expect(libelleJoursEnvoi([1, 2, 3, 4, 5, 6, 7])).toBe('tous les jours');
  });

  it('liste les autres combinaisons, triées', () => {
    expect(libelleJoursEnvoi([3, 1])).toBe('lundi, mercredi');
  });

  it('liste un seul jour', () => {
    expect(libelleJoursEnvoi([6])).toBe('samedi');
  });
});

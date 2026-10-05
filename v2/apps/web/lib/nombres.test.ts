import { describe, expect, it } from 'vitest';
import { formatNombre, formatPourcentage } from './nombres';

// Revue F5, point 8 : `Intl.NumberFormat('fr-FR')`/`toLocaleString('fr-FR')` étaient figés dans
// trois pages (Aujourd'hui, Campagnes, vue d'ensemble de campagne) — `formatNombre`/
// `formatPourcentage` prennent la langue effective en paramètre, jamais en dur.
describe('formatNombre', () => {
  it('sépare les milliers en français (espace fine insécable, U+202F)', () => {
    expect(formatNombre(1234, 'fr')).toBe(`1${' '}234`);
  });

  it('rend la même valeur autrement en anglais (séparateur différent)', () => {
    expect(formatNombre(1234, 'en')).toBe('1,234');
  });

  it('rend la même valeur autrement en néerlandais (séparateur différent)', () => {
    expect(formatNombre(1234, 'nl')).toBe('1.234');
  });
});

describe('formatPourcentage', () => {
  it('ajoute le signe % avec un espace, à la française', () => {
    expect(formatPourcentage(33.3, 'fr')).toBe('33,3 %');
  });

  it('en anglais, la virgule décimale devient un point', () => {
    expect(formatPourcentage(33.3, 'en')).toBe('33.3 %');
  });
});

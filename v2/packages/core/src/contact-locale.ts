/**
 * Calcul de la langue d'un contact (docs/02 : `contacts.locale` déduit du pays
 * et de la région). Cas belge : Flandre → nl, Wallonie/Bruxelles → fr. Pur.
 */
export type ContactLocale = 'fr' | 'en' | 'nl';

export interface LocaleInput {
  readonly country?: string;
  readonly region?: string;
  readonly city?: string;
}

const FLEMISH = [
  'vlaanderen', 'flanders', 'vlaams', 'antwerpen', 'antwerp', 'anvers', 'gent', 'ghent', 'gand',
  'brugge', 'bruges', 'leuven', 'louvain', 'hasselt', 'oost-vlaanderen', 'west-vlaanderen',
  'mechelen', 'kortrijk', 'aalst',
];
const WALLOON = [
  'wallonie', 'wallonia', 'liege', 'liège', 'namur', 'charleroi', 'mons', 'bruxelles', 'brussels',
  'brussel', 'brabant wallon', 'tournai', 'verviers', 'la louviere',
];

export function computeLocale(input: LocaleInput): ContactLocale {
  const country = (input.country ?? '').trim().toUpperCase();
  const region = (input.region ?? '').toLowerCase();
  const city = (input.city ?? '').toLowerCase();

  if (['FR', 'FRANCE'].includes(country)) {
    return 'fr';
  }
  if (['NL', 'NETHERLANDS', 'NEDERLAND', 'PAYS-BAS'].includes(country)) {
    return 'nl';
  }
  if (['BE', 'BELGIUM', 'BELGIQUE', 'BELGIE', 'BELGIË'].includes(country)) {
    const hay = `${region} ${city}`;
    if (FLEMISH.some((f) => hay.includes(f))) {
      return 'nl';
    }
    if (WALLOON.some((w) => hay.includes(w))) {
      return 'fr';
    }
    return 'fr'; // Belgique par défaut : fr (Bruxelles bilingue).
  }
  return 'en';
}

/**
 * Normalisation d'une adresse email pour rapprocher un expéditeur variable
 * (alias `+étiquette`, points ignorés par Gmail) avec l'adresse d'un contact
 * telle qu'enregistrée en base (lot 3 bis, correctif relève Graph).
 *
 * Deux réécritures, toutes deux sur la partie locale (avant l'arobase) :
 *  - `+étiquette` retiré, quel que soit le domaine ;
 *  - points retirés, mais seulement pour `gmail.com` et `googlemail.com` —
 *    Gmail les ignore, ce n'est pas une convention générale (un point reste
 *    significatif pour tout autre domaine).
 *
 * Une chaîne sans arobase est renvoyée triée en minuscules, sans échouer :
 * la fonction rapproche des adresses, elle ne les valide pas.
 */
export function normaliserAdresse(adresse: string): string {
  const brute = adresse.trim().toLowerCase();
  const indexArobase = brute.indexOf('@');
  if (indexArobase === -1) return brute;

  const partieLocale = brute.slice(0, indexArobase);
  const domaine = brute.slice(indexArobase + 1);
  const sansEtiquette = partieLocale.split('+')[0] ?? partieLocale;
  const estGmail = domaine === 'gmail.com' || domaine === 'googlemail.com';
  const partieLocaleFinale = estGmail ? sansEtiquette.replaceAll('.', '') : sansEtiquette;

  return `${partieLocaleFinale}@${domaine}`;
}

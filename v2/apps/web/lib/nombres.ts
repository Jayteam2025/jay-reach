import { getLocale } from 'next-intl/server';
import { defaultLocale, isLocale, type Locale } from '@jay-reach/i18n';

/**
 * `getLocale()` (next-intl) est typé en `string` générique (aucune augmentation `AppConfig`
 * dans ce projet) — ramenée à notre union à trois langues, repli sur le défaut si jamais une
 * valeur hors catalogue s'y glissait (cookie corrompu, ancien nom de langue).
 */
export async function localeCourante(): Promise<Locale> {
  const brute = await getLocale();
  return isLocale(brute) ? brute : defaultLocale;
}

/**
 * Formatage numérique dans la langue effective de l'écran (revue F5, point 8) — jamais
 * `'fr-FR'` figé : trois pages (Aujourd'hui, Campagnes, vue d'ensemble de campagne)
 * créaient chacune leur propre `Intl.NumberFormat('fr-FR')`, ignorant `getLocale()`
 * (`next-intl/server`) déjà lu pour les traductions. Nos codes de langue (`Locale`,
 * `fr`/`en`/`nl`) sont directement des identifiants BCP 47 valides pour `Intl` : pas besoin
 * de les faire pointer vers un pays précis.
 */
export function formatNombre(valeur: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(valeur);
}

/** Pourcentage déjà arrondi (`tauxSurPartis`, une décimale) — même règle de locale que `formatNombre`. */
export function formatPourcentage(valeur: number, locale: Locale): string {
  return `${valeur.toLocaleString(locale)} %`;
}

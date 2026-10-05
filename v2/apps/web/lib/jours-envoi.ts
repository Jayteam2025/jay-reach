/**
 * Libellé compact des jours d'envoi d'un expéditeur (Réglages › Expéditeurs,
 * tâche 20) : « lundi à vendredi » et « tous les jours » sont les deux cas
 * réels du produit (défauts spec §7, boîtes et comptes LinkedIn) — une liste
 * simple couvre tout le reste sans un algorithme de compression de plages
 * qu'aucun réglage actuel n'exercerait.
 *
 * Ne porte AUCUNE chaîne en dur (tour de correction 1, relecture) : chaque
 * jour et les deux formes compactées passent par `t`, le traducteur du
 * namespace `reglages.days` (`fr.json` : `mon`..`sun`, `weekdays`, `everyDay`)
 * — un opérateur en anglais ou en néerlandais ne doit jamais voir « lundi à
 * vendredi » écrit en français.
 */
const CLES_JOURS: Record<number, string> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
};

/** Traducteur minimal requis — la signature de `useTranslations('reglages.days')` (next-intl) la satisfait. */
export type TraducteurJours = (cle: string) => string;

export function libelleJoursEnvoi(jours: readonly number[], t: TraducteurJours): string {
  const tries = [...jours].sort((a, b) => a - b);
  if (tries.length === 7) return t('everyDay');
  if (tries.length === 5 && tries.every((j, i) => j === i + 1)) return t('weekdays');
  return tries.map((j) => t(CLES_JOURS[j] ?? 'mon')).join(', ');
}

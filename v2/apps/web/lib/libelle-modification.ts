import { dateCourte, estDateRelative } from './dates';

/**
 * Libellé de la colonne « Modifié » de Réglages › Plafonds (correctif du 18/09, suite F11) —
 * trois cas, pas deux : `lireReglagesDetail` (`packages/core/src/fonctions/plafonds.ts`) sépare
 * déjà `modifiePar`/`modifieLe`, mais l'écran (`app/(app)/settings/limits/page.tsx`) ne
 * regardait que `modifiePar` et retombait sur « jamais » dès qu'il était nul — y compris pour un
 * réglage posé hors écran (SQL direct, moteur), où `updated_by` est nul mais `updated_at` prouve
 * une modification réelle (constat base : deux plafonds modifiés le 18/09 à 07h59, affichés
 * « jamais »). `modifieLe` seul fait foi pour distinguer « jamais » de « modifié » ; `modifiePar`
 * ne fait qu'ajouter le nom quand il est résoluble.
 *
 * `estRelatif` (constat recette du 18/09, « Modifié le aujourd'hui, 09:59 ») : le gabarit
 * `modifieSansAuteur` choisit lui-même, en ICU (`select`), s'il pose un connecteur devant la
 * date — jamais devant une valeur relative (« aujourd'hui »/« hier »), toujours devant une date
 * absolue (« 4 sept. »).
 */
export function libelleModification(
  modifiePar: string | null,
  modifieLe: string | null,
  t: (cle: string, valeurs?: Record<string, string>) => string,
  maintenant: Date,
  fuseau: string,
): string {
  if (!modifieLe) return t('jamaisModifie');
  const date = dateCourte(modifieLe, maintenant, fuseau);
  const estRelatif = estDateRelative(modifieLe, maintenant, fuseau) ? 'oui' : 'non';
  return modifiePar ? t('modifiePar', { nom: modifiePar, date }) : t('modifieSansAuteur', { date, estRelatif });
}

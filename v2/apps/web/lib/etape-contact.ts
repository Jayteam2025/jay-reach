import type { StatutContactCampagne } from '@jay-reach/core';

/**
 * Statuts pour lesquels une inscription est terminée (`termine`) ou arrêtée
 * (`ecarte`) — R81 : sur ces deux statuts, `etape` (déjà bornée au nombre
 * d'étapes de la campagne par `etapeAffichee`, `packages/core`) ne désigne
 * plus une étape EN COURS, donc un simple « Étape N » lirait comme si la
 * séquence continuait. Le libellé du statut (déjà traduit, colonne État)
 * remplace le nom d'étape plutôt que d'inventer un second mot (« terminée »/
 * « arrêtée ») qui devrait rester synchronisé avec lui.
 */
const STATUTS_FIN: ReadonlySet<StatutContactCampagne> = new Set(['termine', 'ecarte']);

/**
 * Texte de la colonne « Étape » (table des contacts, campagne ET globale,
 * tâches 10 et 18) : `t('contacts.step', { n })` en cours, ou `t('contacts.stepEnded', { n, libelle })`
 * une fois la séquence terminée/arrêtée — même règle que la fiche contact
 * (tâche 17, « Étape 1 sur 1, séquence arrêtée à la réponse »). `null` sans
 * inscription (pas de colonne à afficher, `noStep` fait foi côté appelant).
 */
export function texteEtape(
  etape: number | null,
  statut: StatutContactCampagne,
  libelleStatut: string,
  t: (cle: string, valeurs?: Record<string, string | number>) => string,
): string | null {
  if (etape === null) return null;
  if (STATUTS_FIN.has(statut)) return t('contacts.stepEnded', { n: etape, libelle: libelleStatut });
  return t('contacts.step', { n: etape });
}

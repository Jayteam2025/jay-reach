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
 * tâches 10 et 18) : `t('step', { n })` en cours, ou `t('stepEnded', { n, libelle })`
 * une fois la séquence terminée/arrêtée — même règle que la fiche contact
 * (tâche 17, « Étape 1 sur 1, séquence arrêtée à la réponse »). `null` sans
 * inscription (pas de colonne à afficher, `noStep` fait foi côté appelant).
 *
 * Clés RELATIVES (`step`/`stepEnded`, pas `contacts.step`) : les deux écrans
 * qui appellent cette fonction n'ont pas le même espace de noms — la page
 * Contacts globale (tâche 18) lit `getTranslations('contacts')`, où ces clés
 * sont directement `contacts.step`/`contacts.stepEnded` ; la page Contacts
 * d'une campagne (tâche 10) lit `getTranslations('campagne')`, où elles sont
 * `campagne.contacts.step`/`campagne.contacts.stepEnded`. Un préfixe codé en
 * dur ici conviendrait à l'un des deux et casserait silencieusement l'autre
 * (`t('contacts.step', …)` depuis le namespace `contacts` cherche
 * `contacts.contacts.step`, qui n'existe pas — next-intl affiche alors le
 * chemin brut au lieu du texte). Chaque appelant passe donc un `t` déjà
 * scopé sur SON PROPRE sous-arbre « contacts » : tel quel pour la page
 * globale, un petit adaptateur (cle, valeurs) => t(`contacts.${cle}`, valeurs)
 * pour la page de campagne (voir son `page.tsx`).
 */
export function texteEtape(
  etape: number | null,
  statut: StatutContactCampagne,
  libelleStatut: string,
  t: (cle: 'step' | 'stepEnded', valeurs: Record<string, string | number>) => string,
): string | null {
  if (etape === null) return null;
  if (STATUTS_FIN.has(statut)) return t('stepEnded', { n: etape, libelle: libelleStatut });
  return t('step', { n: etape });
}

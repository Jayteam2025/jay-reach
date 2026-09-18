/**
 * Logique d'affichage pure de la carte d'un compte LinkedIn (constat recette du 18/09) —
 * séparée de `CarteCompteLinkedIn.tsx` pour rester testable sans contexte next-intl, même
 * convention que `boite-affichage.ts`.
 *
 * Avant ce correctif, la carte affichait DEUX puces côte à côte quand le compte était actif
 * mais sans expéditeur LinkedIn actif (F15, `CompteLinkedIn.envoiPossible`) : « Active » (ton
 * bon) ET « Aucun envoi ne partira : expéditeur non activé » (ton attention) en même temps —
 * deux affirmations contradictoires à l'écran. Même priorité que `puceEtatBoite` : ce qui
 * empêche réellement d'envoyer l'emporte sur l'activation choisie par l'opérateur, dans UNE
 * seule puce qui porte les deux faits plutôt que de les taire l'un ou l'autre.
 */
import type { CompteLinkedIn } from '@jay-reach/core';
import type { PuceTon } from '../ui';

export function puceEtatCompteLinkedIn(
  compte: Pick<CompteLinkedIn, 'active' | 'connecte' | 'envoiPossible'>,
): { ton: PuceTon; cle: string } {
  if (compte.connecte && !compte.envoiPossible) {
    return { ton: 'attention', cle: compte.active ? 'activeSenderMissing' : 'senderMissing' };
  }
  return compte.active ? { ton: 'bon', cle: 'active' } : { ton: 'gris', cle: 'inactive' };
}

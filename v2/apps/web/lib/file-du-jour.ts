/**
 * « Déjà partis » d'une file du jour (F12) : le départ RÉEL (`livre`), jamais
 * la simple remise au transporteur (`envoye`) — un email remis à SalesBlink
 * mais pas encore envoyé n'est pas « déjà parti ». Extrait en fonction pure
 * (testable) après la revue qui a trouvé la carte File du jour de la vue
 * d'ensemble d'une campagne (`campaigns/[id]/page.tsx`) encore branchée sur
 * `envoye`, alors qu'`aujourdhui.ts` et `campagnes.ts::listerFileDuJour`
 * avaient déjà basculé sur `livre` — sans elle, cette carte comptait un
 * nombre de « partis » différent de celui de la page Aujourd'hui et de
 * l'onglet File du jour pour le même jour et la même campagne.
 */
import type { EnvoiPrevu } from '@jay-reach/core';

export function compterPartis(fileDuJour: readonly Pick<EnvoiPrevu, 'livre'>[]): number {
  return fileDuJour.filter((envoi) => envoi.livre).length;
}

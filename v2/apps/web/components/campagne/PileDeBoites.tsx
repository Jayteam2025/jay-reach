import type { BoiteCampagne } from '@jay-reach/core';
import { TuileLogo } from '../ui';

export interface PileDeBoitesProps {
  boites: BoiteCampagne[];
}

/**
 * Rangée des boîtes d'envoi d'une campagne (colonne « Boîtes » de la liste).
 * `.jr-puces` (flex + gap, sans marge négative), jamais `.jr-pile` (tour de
 * correction 2) : `.jr-pile` chevauche ses enfants de -8px pour des
 * `Avatar` ronds de 26px — une `TuileLogo` carrée de 32px y déborderait et
 * les tuiles se retrouvaient collées les unes sur les autres.
 */
export function PileDeBoites({ boites }: PileDeBoitesProps) {
  return (
    <span className="jr-puces">
      {boites.map((boite) => (
        <span key={boite.id} title={boite.identite}>
          <TuileLogo marque={boite.marque ?? 'email'} />
        </span>
      ))}
    </span>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { reprendreInscription } from '../../app/actions/campaigns';

export interface BoutonReprendreProps {
  inscriptionId: string;
  campagneId: string;
  libelle: string;
}

/**
 * Bouton « Reprendre » (tâche 29, lot 2, R93) — même patron que
 * `BoutonEcarterContact` : façade `reprendreInscription`
 * (`apps/web/app/actions/campaigns.ts`) → cœur `reprendreInscription`
 * (`packages/core/src/fonctions/sequence.ts`). Pas de `useRouter` :
 * la Server Action revalide les pages, utilisé pour une inscription
 * `paused`/`paused_absence` — le libellé (« Reprendre », toujours le même
 * quel que soit le motif de pause depuis F11 : une pause d'absence ne reprend
 * plus « maintenant », voir `SectionOuEnEstOn`/`TableContacts`) reste choisi
 * par l'appelant.
 */
export function BoutonReprendre({ inscriptionId, campagneId, libelle }: BoutonReprendreProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await reprendreInscription(inscriptionId, campagneId);
      if (!res.ok) setErreur(res.error);
    });
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="jr-bouton petit" disabled={pending} aria-busy={pending} onClick={lancer}>
        {libelle}
      </button>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </span>
  );
}

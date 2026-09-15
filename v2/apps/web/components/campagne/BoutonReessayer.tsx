'use client';

import { useState, useTransition } from 'react';
import { actionRelancerEnvoi } from '../../app/actions/file-du-jour';

export interface BoutonReessayerProps {
  actionId: string;
  campagneId: string;
  libelle: string;
}

/** Bouton « Réessayer » d'une ligne en échec de la file du jour (E3) : façade `actionRelancerEnvoi` → `relancerEnvoi`. */
export function BoutonReessayer({ actionId, campagneId, libelle }: BoutonReessayerProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionRelancerEnvoi(actionId, campagneId);
      if (res.ok) {
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <span className="jr-actions-en-ligne">
      <button type="button" className="jr-bouton petit" disabled={pending} aria-busy={pending} onClick={lancer}>
        {libelle}
      </button>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </span>
  );
}

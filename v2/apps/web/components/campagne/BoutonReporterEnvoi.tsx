'use client';

import { useState, useTransition } from 'react';
import { actionReporterEnvoi } from '../../app/actions/file-du-jour';

export interface BoutonReporterEnvoiProps {
  actionId: string;
  campagneId: string;
  libelle: string;
}

/** Bouton « Reporter » de la file du jour : façade `actionReporterEnvoi` → `reporterEnvoi`. */
export function BoutonReporterEnvoi({ actionId, campagneId, libelle }: BoutonReporterEnvoiProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionReporterEnvoi(actionId, campagneId);
      if (res.ok) {
        window.location.reload();
      } else {
        setErreur(res.error);
      }
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

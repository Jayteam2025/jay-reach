'use client';

import { useState, useTransition } from 'react';
import { actionEcarterDuneCampagne } from '../../app/actions/file-du-jour';

export interface BoutonEcarterContactProps {
  contactId: string;
  campagneId: string;
  libelle: string;
}

/**
 * Bouton « Écarter » (onglets Contacts et File du jour, tiroir de relecture) :
 * façade `actionEcarterDuneCampagne` → `ecarterDuneCampagne`
 * (`packages/core/src/fonctions/file-du-jour.ts`). Pas de `useRouter` (voir
 * `BoutonChercherEmail`) : la Server Action revalide les pages après succès.
 */
export function BoutonEcarterContact({ contactId, campagneId, libelle }: BoutonEcarterContactProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionEcarterDuneCampagne(contactId, campagneId);
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

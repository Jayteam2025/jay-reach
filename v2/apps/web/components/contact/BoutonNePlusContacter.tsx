'use client';

import { useState, useTransition } from 'react';
import { actionNePlusContacter } from '../../app/actions/contacts';

export interface BoutonNePlusContacterProps {
  contactId: string;
  libelle: string;
}

/**
 * « Ne plus contacter » (pied de la fiche contact) : façade
 * `actionNePlusContacter` → `nePlusContacter` (`packages/core/src/fonctions/contacts.ts`),
 * qui pose le statut, la suppression email et arrête les inscriptions
 * vivantes de TOUTES les campagnes du contact — pas seulement celle-ci.
 * Pas de confirmation (même convention que `BoutonEcarterContact` : un clic,
 * un rechargement).
 */
export function BoutonNePlusContacter({ contactId, libelle }: BoutonNePlusContacterProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionNePlusContacter(contactId);
      if (res.ok) {
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="jr-bouton danger" disabled={pending} aria-busy={pending} onClick={lancer}>
        {libelle}
      </button>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </span>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { actionChercherEmailContact } from '../../app/actions/contacts';

export interface BoutonChercherEmailContactProps {
  contactId: string;
  libelle: string;
  cout: string;
}

/**
 * Bouton « Chercher l'email » de la fiche contact : façade
 * `actionChercherEmailContact` → `chercherEmail` (`packages/core/src/fonctions/contacts.ts`,
 * tâche 17). Distinct de `BoutonChercherEmail` (tâche 10, `campagne/`) qui
 * appelle `enrichirMaintenant` par `signalId` — celui-ci prend un `contactId`,
 * seule information toujours disponible depuis la fiche.
 */
export function BoutonChercherEmailContact({ contactId, libelle, cout }: BoutonChercherEmailContactProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionChercherEmailContact(contactId);
      if (res.ok) {
        setFait(true);
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  if (fait) {
    return <span className="jr-secondaire">{cout}</span>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" className="jr-bouton petit" disabled={pending} aria-busy={pending} onClick={lancer}>
        {libelle}
      </button>
      <small className="jr-secondaire">{erreur ?? cout}</small>
    </span>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { actionChercherEmailContact } from '../../app/actions/contacts';

export interface BoutonChercherEmailContactProps {
  contactId: string;
  libelle: string;
  cout: string;
  /**
   * Motif déjà traduit d'indisponibilité — non `null` quand `enrichissements_par_jour`
   * (réglages de l'organisation) vaut 0 : même garde-fou que `BoutonChercherEmail`
   * (`campagne/`), voir son commentaire — chargé une fois par la page, jamais par ligne.
   */
  raisonIndisponible: string | null;
}

/**
 * Bouton « Chercher l'email » de la fiche contact : façade
 * `actionChercherEmailContact` → `chercherEmail` (`packages/core/src/fonctions/contacts.ts`,
 * tâche 17). Distinct de `BoutonChercherEmail` (tâche 10, `campagne/`) qui
 * appelle `enrichirMaintenant` par `signalId` — celui-ci prend un `contactId`,
 * seule information toujours disponible depuis la fiche.
 */
export function BoutonChercherEmailContact({ contactId, libelle, cout, raisonIndisponible }: BoutonChercherEmailContactProps) {
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

  // Plafond à 0 (constat produit, 18/09) : même traitement que `BoutonChercherEmail`, voir
  // son commentaire — bouton visible, désactivé, raison dessous (`.jr-tache-aide`).
  if (raisonIndisponible) {
    return (
      <span className="jr-action-empilee">
        <button type="button" className="jr-bouton petit" disabled>
          {libelle}
        </button>
        <p className="jr-aide jr-tache-aide">{raisonIndisponible}</p>
      </span>
    );
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

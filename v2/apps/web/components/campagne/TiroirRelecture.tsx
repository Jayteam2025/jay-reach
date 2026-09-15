'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ApercuEnvoi } from '@jay-reach/core';
import { Tiroir, Message, Puce } from '../ui';
import { setActionApproval } from '../../app/actions/approvals';
import { actionEcarterDuneCampagne } from '../../app/actions/file-du-jour';

export interface TiroirRelectureLibelles {
  titre: string;
  description: string;
  aRelire: string;
  fermer: string;
  aide: string;
  ecarter: string;
  modifierLeTexte: string;
  bientot: string;
  envoyerTelQuel: string;
}

export interface TiroirRelectureProps {
  actionId: string;
  contactId: string | null;
  campagneId: string;
  organisationId: string;
  apercu: ApercuEnvoi | null;
  libelles: TiroirRelectureLibelles;
}

/**
 * Tiroir « Relire avant envoi » (`?relire=<actionId>`), ouvert depuis la file
 * du jour. `apercu` est déjà lu côté serveur par la page (`apercuEnvoi`) : ce
 * composant client ne fait que l'afficher et brancher les trois actions.
 * `useRouter` ici (fermeture, `router.refresh()`) : ce composant n'entre pas
 * dans le périmètre du test de rendu demandé par le brief (contrairement à
 * `TableContacts`), même contrainte que `BoutonLancerPause`.
 */
export function TiroirRelecture({ actionId, contactId, campagneId, organisationId, apercu, libelles }: TiroirRelectureProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function fermer() {
    router.push(`?`, { scroll: false });
  }

  function ecarter() {
    if (!contactId) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionEcarterDuneCampagne(contactId, campagneId);
      if (res.ok) {
        router.refresh();
        fermer();
      } else {
        setErreur(res.error);
      }
    });
  }

  function envoyerTelQuel() {
    setErreur(null);
    startTransition(async () => {
      const res = await setActionApproval(organisationId, actionId, 'approve');
      if (res.ok) {
        router.refresh();
        fermer();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={libelles.fermer}
      titre={libelles.titre}
      description={libelles.description}
      puces={
        <Puce ton="attention" point>
          {libelles.aRelire}
        </Puce>
      }
      pied={
        <>
          <button type="button" className="jr-bouton" disabled={pending || !contactId} onClick={ecarter}>
            {libelles.ecarter}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="jr-bouton" disabled title={libelles.bientot}>
              {libelles.modifierLeTexte}
            </button>
            <button type="button" className="jr-bouton principal" disabled={pending} onClick={envoyerTelQuel}>
              {libelles.envoyerTelQuel}
            </button>
          </div>
        </>
      }
    >
      {apercu && (
        <Message
          direction="sortant"
          auteur={apercu.expediteur ?? '—'}
          date={apercu.destinataireMasque ?? ''}
          objet={apercu.objet}
          corps={apercu.corps}
        />
      )}
      <p className="jr-aide">{libelles.aide}</p>
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </Tiroir>
  );
}

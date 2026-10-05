'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ApercuEnvoi } from '@jay-reach/core';
import { Tiroir, Message, Puce } from '../ui';
import type { PuceTon } from '../ui';
import { setActionApproval } from '../../app/actions/approvals';
import { actionEcarterDuneCampagne } from '../../app/actions/file-du-jour';

export interface TiroirRelectureLibelles {
  titre: string;
  fermer: string;
  /** Libellé du bloc « Email tel qu'il partira » (D3) — pas le sous-titre du tiroir, remplacé par `sousTitre`. */
  emailTitre: string;
  /** Heure prévue déjà formatée (fuseau de l'organisation, même convention que `EnvoiPrevu.heure` d'`aujourdhui.ts`) — `null` si jamais programmé. */
  heureLibelle: string | null;
  /** Statut réel de l'action (`campagne.queue.status.*`, sans compteur — D1, tour de correction 1). */
  statut: string;
  /** Ton de la puce de statut — même correspondance que la puce d'état de `TableFileDuJour` (`TON_ETAT`). */
  statutTon: PuceTon;
  /** « Score {n} », `null` sans score (D1). */
  score: string | null;
  /** Sous-titre « {nom} · {poste} · {entreprise} · prévu {HH:MM} depuis {expéditeur} », segments absents déjà omis par l'appelant. */
  sousTitre: string;
  /** Bloc « Pourquoi ce contact » (D2) — `null` masque tout le bloc (aucun signal d'origine, R36). */
  pourquoi: { titre: string; detail: string } | null;
  pourquoiTitre: string;
  /** Sur-titre du message (D3) : « étape {n} · {nom de l'étape} ». */
  etape: string;
  /** Avertissement des variables manquantes (C5, D4) — `null` si aucune. */
  avertissementVariables: string | null;
  aide: string;
  ecarter: string;
  modifierLeTexte: string;
  bientot: string;
  envoyerTelQuel: string;
  /** « Cet envoi est {statut} : plus rien à relire. » — `null` tant que l'envoi est encore à relire (R39, D6). */
  dejaTraite: string | null;
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
 * Pied du tiroir (R39) : les trois actions tant que l'envoi est encore à
 * relire (`scheduled`/`pending_approval`), sinon une ligne discrète — jamais
 * les deux. Composant à part, sans `useRouter` : c'est lui que le brief
 * demande de tester par rendu (D6), la coquille `TiroirRelecture` restant
 * hors du périmètre testable pour la même raison que `BoutonLancerPause`.
 */
export function PiedTiroirRelecture({
  dejaTraite,
  pending,
  peutEcarter,
  libelles,
  onEcarter,
  onEnvoyerTelQuel,
}: {
  dejaTraite: string | null;
  pending: boolean;
  peutEcarter: boolean;
  libelles: Pick<TiroirRelectureLibelles, 'ecarter' | 'modifierLeTexte' | 'bientot' | 'envoyerTelQuel'>;
  onEcarter: () => void;
  onEnvoyerTelQuel: () => void;
}) {
  if (dejaTraite) {
    return <p className="jr-secondaire">{dejaTraite}</p>;
  }
  return (
    <>
      <button type="button" className="jr-bouton" disabled={pending || !peutEcarter} onClick={onEcarter}>
        {libelles.ecarter}
      </button>
      <div className="jr-actions">
        <button type="button" className="jr-bouton" disabled title={libelles.bientot}>
          {libelles.modifierLeTexte}
        </button>
        <button type="button" className="jr-bouton principal" disabled={pending} onClick={onEnvoyerTelQuel}>
          {libelles.envoyerTelQuel}
        </button>
      </div>
    </>
  );
}

/**
 * Tiroir « Relire avant envoi » (`?relire=<actionId>`), ouvert depuis la file
 * du jour. `apercu` et tous les textes composés (`libelles`) sont déjà résolus
 * côté serveur par la page (`apercuEnvoi` + `getTranslations`) : ce composant
 * client ne fait qu'afficher et brancher les actions. `useRouter` ici
 * (fermeture ; la Server Action revalide déjà la page) : ce composant n'entre pas dans le
 * périmètre du test de rendu demandé par le brief (contrairement à
 * `TableContacts`/`PiedTiroirRelecture`), même contrainte que `BoutonLancerPause`.
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
      description={libelles.sousTitre}
      puces={
        <>
          <Puce ton={libelles.statutTon} point>
            {libelles.statut}
          </Puce>
          {libelles.score && <Puce>{libelles.score}</Puce>}
        </>
      }
      pied={
        <PiedTiroirRelecture
          dejaTraite={libelles.dejaTraite}
          pending={pending}
          peutEcarter={contactId !== null}
          libelles={libelles}
          onEcarter={ecarter}
          onEnvoyerTelQuel={envoyerTelQuel}
        />
      }
    >
      {libelles.pourquoi && (
        <>
          <h4>{libelles.pourquoiTitre}</h4>
          <p>
            <b>{libelles.pourquoi.titre}</b>
            <br />
            <span className="jr-secondaire">{libelles.pourquoi.detail}</span>
          </p>
        </>
      )}
      <h4>
        {libelles.emailTitre} <span>{libelles.etape}</span>
      </h4>
      {apercu && (
        <Message
          direction="sortant"
          auteur={apercu.expediteur ?? '—'}
          date={libelles.heureLibelle ?? '—'}
          destinataire={apercu.destinataire ?? undefined}
          avertissement={
            libelles.avertissementVariables ? (
              <div className="jr-bandeau attention">{libelles.avertissementVariables}</div>
            ) : undefined
          }
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

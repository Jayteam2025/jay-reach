'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Carte, CleValeur, Interrupteur, Puce } from '../ui';
import { actionBasculerPauseEnvoi } from '../../app/actions/moteur';

export interface PauseEnvoiLibelles {
  titre: string;
  description: string;
  etat: string;
  levee: string;
  active: string;
  dernierePause: string;
  aucunePause: string;
  /** Gabarit « {depuis} à {jusqua} · {parQui} » — remplacé tel quel, jamais retraduit. */
  dernierePauseGabarit: string;
}

export interface DernierePauseAffichee {
  depuis: string;
  jusqua: string;
  parQui: string;
}

// Corps pur (aucun hook) : testable par `renderToStaticMarkup`, la bascule
// elle-même vit dans `PauseEnvoi` ci-dessous (dépend de `useRouter`).
export interface CorpsPauseEnvoiProps {
  actif: boolean;
  dernierePause: DernierePauseAffichee | null;
  disabled: boolean;
  onChange: (actif: boolean) => void;
  libelles: PauseEnvoiLibelles;
}

export function CorpsPauseEnvoi({ actif, dernierePause, disabled, onChange, libelles }: CorpsPauseEnvoiProps) {
  const texteDernierePause = dernierePause
    ? libelles.dernierePauseGabarit
        .replace('{depuis}', dernierePause.depuis)
        .replace('{jusqua}', dernierePause.jusqua)
        .replace('{parQui}', dernierePause.parQui)
    : libelles.aucunePause;

  return (
    <Carte titre={libelles.titre}>
      <div className="jr-pause-ligne">
        <div className="texte">{libelles.description}</div>
        <Interrupteur actif={actif} libelle={libelles.titre} disabled={disabled} onChange={onChange} />
      </div>
      <CleValeur
        libelle={libelles.etat}
        valeur={
          <Puce ton={actif ? 'erreur' : 'bon'} point>
            {actif ? libelles.active : libelles.levee}
          </Puce>
        }
      />
      <CleValeur libelle={libelles.dernierePause} valeur={texteDernierePause} />
    </Carte>
  );
}

export interface PauseEnvoiProps {
  actif: boolean;
  dernierePause: DernierePauseAffichee | null;
  libelles: PauseEnvoiLibelles;
  erreurLibelle: string;
}

export function PauseEnvoi({ actif, dernierePause, libelles, erreurLibelle }: PauseEnvoiProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actifLocal, setActifLocal] = useState(actif);
  const [erreur, setErreur] = useState<string | null>(null);

  function basculer(prochainActif: boolean) {
    setErreur(null);
    startTransition(async () => {
      const res = await actionBasculerPauseEnvoi(prochainActif);
      if (res.ok) {
        setActifLocal(prochainActif);
        router.refresh();
      } else {
        setErreur(res.error ?? erreurLibelle);
      }
    });
  }

  return (
    <>
      <CorpsPauseEnvoi actif={actifLocal} dernierePause={dernierePause} disabled={pending} onChange={basculer} libelles={libelles} />
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </>
  );
}

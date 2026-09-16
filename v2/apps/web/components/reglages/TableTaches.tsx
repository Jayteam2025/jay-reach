'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bouton, Carte, Puce } from '../ui';
import { actionLancerTache } from '../../app/actions/moteur';

export interface LigneTache {
  cle: string;
  titre: string;
  detail: string;
  lancable: boolean;
  enCours?: boolean;
}

export interface TableTachesLibelles {
  titre: string;
  sousTitre: string;
  lancer: string;
  enCours: string;
}

// Corps pur (aucun hook) — testable par `renderToStaticMarkup`.
export interface CorpsTableTachesProps {
  lignes: LigneTache[];
  enAttente: string | null;
  onLancer: (cle: string) => void;
  libelles: TableTachesLibelles;
}

export function CorpsTableTaches({ lignes, enAttente, onLancer, libelles }: CorpsTableTachesProps) {
  return (
    <Carte
      titre={
        <>
          {libelles.titre} <small>{libelles.sousTitre}</small>
        </>
      }
    >
      <div style={{ paddingTop: 4 }}>
        {lignes.map((ligne) => (
          <div key={ligne.cle} className="jr-source">
            <span className="jr-tuile-logo em">▶</span>
            <span>
              <b>{ligne.titre}</b>
              <small>{ligne.detail}</small>
            </span>
            <span className="jr-actions">
              {ligne.enCours && <Puce ton="accent">{libelles.enCours}</Puce>}
              <Bouton
                taille="petit"
                disabled={!ligne.lancable || enAttente !== null}
                aria-busy={enAttente === ligne.cle}
                onClick={() => onLancer(ligne.cle)}
              >
                {libelles.lancer}
              </Bouton>
            </span>
          </div>
        ))}
      </div>
    </Carte>
  );
}

export interface TableTachesProps {
  lignes: LigneTache[];
  libelles: TableTachesLibelles;
  erreurLibelle: string;
}

export function TableTaches({ lignes, libelles, erreurLibelle }: TableTachesProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enAttente, setEnAttente] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer(cle: string) {
    setErreur(null);
    setEnAttente(cle);
    startTransition(async () => {
      const res = await actionLancerTache(cle);
      setEnAttente(null);
      if (res.ok) {
        router.refresh();
      } else {
        setErreur(res.error ?? erreurLibelle);
      }
    });
  }

  return (
    <>
      <CorpsTableTaches lignes={lignes} enAttente={enAttente} onLancer={lancer} libelles={libelles} />
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </>
  );
}

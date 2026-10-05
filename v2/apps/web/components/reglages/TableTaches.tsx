'use client';

import { Fragment, useState, useTransition } from 'react';
import { Bouton, Carte, Puce } from '../ui';
import { actionLancerTache } from '../../app/actions/moteur';

export interface LigneTache {
  cle: string;
  titre: string;
  detail: string;
  lancable: boolean;
  enCours?: boolean;
  /**
   * Ligne d'aide sous la tâche (tour de correction 1, Important n° 1) :
   * réservée aux tâches dont le bouton est désactivé parce qu'elles tournent
   * déjà en continu côté worker (scoring, enrichissement) — jamais pour
   * « sources » (bouton actif, rien à expliquer) ni pour « relève » (déjà
   * couverte par sa propre carte en lecture seule, `releveLectureSeule`).
   * Un bouton désactivé sans cette aide laisserait l'opérateur croire à un
   * bug plutôt qu'à un fonctionnement normal.
   */
  aide?: string;
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
          <Fragment key={ligne.cle}>
            <div className="jr-source">
              <span className="jr-tuile-logo em">▶</span>
              <span>
                <b>{ligne.titre}</b>
                <small>{ligne.detail}</small>
              </span>
              <span className="jr-actions">
                {ligne.enCours && <Puce ton="accent">{libelles.enCours}</Puce>}
                {/* Tour de correction F6, point 15 : une tâche avec une aide (« aucun déclenchement
                    manuel possible ici ») n'a pas de bouton — un bouton grisé qui ne fera jamais
                    rien n'a pas sa place, la phrase suffit. */}
                {!ligne.aide && (
                  <Bouton
                    taille="petit"
                    disabled={!ligne.lancable || enAttente !== null}
                    aria-busy={enAttente === ligne.cle}
                    onClick={() => onLancer(ligne.cle)}
                  >
                    {libelles.lancer}
                  </Bouton>
                )}
              </span>
            </div>
            {ligne.aide && <p className="jr-aide jr-tache-aide">{ligne.aide}</p>}
          </Fragment>
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
  const [, startTransition] = useTransition();
  const [enAttente, setEnAttente] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer(cle: string) {
    setErreur(null);
    setEnAttente(cle);
    startTransition(async () => {
      const res = await actionLancerTache(cle);
      setEnAttente(null);
      if (!res.ok) {
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

'use client';

import { Fragment, useState, useTransition } from 'react';
import { Bouton, Carte, Puce } from '../ui';
import { actionLancerTache } from '../../app/actions/moteur';
import { ConfirmationEnLigne } from './ConfirmationEnLigne';

interface LigneTacheBase {
  cle: string;
  titre: string;
  detail: string;
  lancable: boolean;
  enCours?: boolean;
}

/**
 * Une tâche porte soit une aide (elle n'a pas de bouton), soit la phrase de confirmation de son
 * bouton — jamais les deux, jamais aucune des deux :
 *
 * - `aide` (tour de correction 1, Important n° 1) : réservée aux tâches qui tournent déjà en
 *   continu côté worker (scoring, enrichissement), donc sans bouton — jamais pour « sources »
 *   (bouton actif, rien à expliquer) ni pour « relève » (déjà couverte par sa propre carte en
 *   lecture seule, `releveLectureSeule`). Un bouton désactivé sans cette aide laisserait
 *   l'opérateur croire à un bug plutôt qu'à un fonctionnement normal.
 * - `confirmation` : ce que « Lancer » déclenche, dit avant de le faire. Un clic sur « Lancer »
 *   n'exécute rien : il pose cette question, et c'est « Oui, lancer » qui part.
 */
export type LigneTache = LigneTacheBase &
  ({ aide: string; confirmation?: undefined } | { aide?: undefined; confirmation: string });

export interface TableTachesLibelles {
  titre: string;
  sousTitre: string;
  lancer: string;
  enCours: string;
  confirmer: string;
  annuler: string;
}

// Corps pur (aucun hook) — testable par `renderToStaticMarkup`.
export interface CorpsTableTachesProps {
  lignes: LigneTache[];
  /** La tâche en cours d'exécution (après confirmation). */
  enAttente: string | null;
  /** La tâche dont on demande la confirmation, ou `null`. */
  aConfirmer: string | null;
  /** Clic sur « Lancer » : ouvre la confirmation, ne lance rien. */
  onDemander: (cle: string) => void;
  /** Clic sur « Annuler » : referme la confirmation, ne lance rien. */
  onAnnuler: () => void;
  /** Clic sur « Oui, lancer » : la seule voie qui exécute la tâche. */
  onLancer: (cle: string) => void;
  libelles: TableTachesLibelles;
}

export function CorpsTableTaches({
  lignes,
  enAttente,
  aConfirmer,
  onDemander,
  onAnnuler,
  onLancer,
  libelles,
}: CorpsTableTachesProps) {
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
                    onClick={() => onDemander(ligne.cle)}
                  >
                    {libelles.lancer}
                  </Bouton>
                )}
              </span>
            </div>
            {ligne.aide && <p className="jr-aide jr-tache-aide">{ligne.aide}</p>}
            {ligne.confirmation !== undefined && aConfirmer === ligne.cle && (
              <ConfirmationEnLigne
                texte={ligne.confirmation}
                libelleConfirmer={libelles.confirmer}
                libelleAnnuler={libelles.annuler}
                onConfirmer={() => onLancer(ligne.cle)}
                onAnnuler={onAnnuler}
                pending={enAttente !== null}
              />
            )}
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
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function demander(cle: string) {
    setErreur(null);
    setAConfirmer(cle);
  }

  function lancer(cle: string) {
    setErreur(null);
    setAConfirmer(null);
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
      <CorpsTableTaches
        lignes={lignes}
        enAttente={enAttente}
        aConfirmer={aConfirmer}
        onDemander={demander}
        onAnnuler={() => setAConfirmer(null)}
        onLancer={lancer}
        libelles={libelles}
      />
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </>
  );
}

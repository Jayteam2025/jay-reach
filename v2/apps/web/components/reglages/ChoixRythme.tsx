'use client';

/**
 * Le rythme d'envoi LinkedIn en trois crans (Réglages › LinkedIn).
 *
 * Un seul choix pose quatre valeurs : invitations par semaine, messages par semaine, plage horaire
 * et jours. Les tenir cohérentes entre elles à la main est un travail d'expert, et c'est leur
 * incohérence qui a étranglé le moteur pendant une semaine sans que l'écran le dise. Les huit
 * réglages fins restent accessibles, repliés sous ce bloc : on ne retire rien, on descend d'un cran.
 *
 * Deux règles de dessin que le code doit tenir :
 * - un cran est marqué « appliqué », jamais « choisi » — `lireRythme` lit les valeurs en vigueur,
 *   donc une organisation qui n'a jamais rien réglé se lit « normal » sans l'avoir décidé ;
 * - le bouton n'apparaît que si la sélection diffère de ce qui s'applique, comme le fait déjà
 *   `PlafondsLinkedin` : poser un cran écrase quatre réglages, ce n'est pas un geste à faire d'un
 *   clic distrait.
 */
import { useState, useTransition } from 'react';
import type { Rythme } from '@jay-reach/core';
import { Bouton } from '../ui';
import { actionEcrireRythme } from '../../app/actions/plafonds';
import { appliquerRythme, etatChoixRythme, type CranRythme } from './rythme-affichage';

export interface CranAffiche {
  cle: CranRythme;
  nom: string;
  invitations: number;
  messages: number;
  /** Déjà composé (« 9h-18h ») : ce composant ne formate aucune heure. */
  horaires: string;
}

export interface ChoixRythmeProps {
  applique: Rythme;
  crans: CranAffiche[];
  peutModifier: boolean;
  libelles: {
    groupe: string;
    invitations: string;
    messages: string;
    horaires: string;
    applique: string;
    appliquer: string;
    jours: string;
    surMesureTitre: string;
    surMesureTexte: string;
  };
}

export function ChoixRythme({ applique, crans, peutModifier, libelles }: ChoixRythmeProps) {
  const [selection, setSelection] = useState<CranRythme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const etat = etatChoixRythme(
    crans.map((c) => c.cle),
    applique,
    selection,
  );

  function appliquer(cran: CranRythme) {
    setErreur(null);
    startTransition(async () => {
      const message = await appliquerRythme(cran, actionEcrireRythme);
      setSelection(null);
      setErreur(message);
    });
  }

  return (
    <>
      {etat.surMesure && (
        <p className="jr-rythme-tete">
          <b>{libelles.surMesureTitre}</b> {libelles.surMesureTexte}
        </p>
      )}

      <div className="jr-rythmes" role="radiogroup" aria-label={libelles.groupe}>
        {crans.map((cran) => {
          const e = etat.crans.find((c) => c.cle === cran.cle);
          return (
            <label key={cran.cle} className={`jr-rythme${e?.choisi ? ' choisi' : ''}`}>
              <input
                type="radio"
                name="jr-rythme"
                value={cran.cle}
                checked={e?.choisi ?? false}
                disabled={!peutModifier || pending}
                onChange={() => setSelection(cran.cle)}
              />
              <span className="jr-rythme-nom">
                {cran.nom}
                {e?.applique && <em>{libelles.applique}</em>}
              </span>
              <dl>
                <div>
                  <dt>{libelles.invitations}</dt>
                  <dd>{cran.invitations}</dd>
                </div>
                <div>
                  <dt>{libelles.messages}</dt>
                  <dd>{cran.messages}</dd>
                </div>
                <div>
                  <dt>{libelles.horaires}</dt>
                  <dd>{cran.horaires}</dd>
                </div>
              </dl>
            </label>
          );
        })}
      </div>

      <div className="jr-rythme-pied">
        {/* « Du lundi au vendredi » décrit ce que pose un cran, pas ce qui est réglé. En sur
            mesure, les jours réels sont tout autres — l'afficher quand même ferait dire à l'écran
            exactement le genre de chose fausse que ce chantier corrige. */}
        <p>{etat.surMesure ? null : libelles.jours}</p>
        {etat.aAppliquer && peutModifier && (
          <Bouton
            variante="principal"
            taille="petit"
            onClick={() => appliquer(etat.aAppliquer as CranRythme)}
            disabled={pending}
            aria-busy={pending}
          >
            {libelles.appliquer}
          </Bouton>
        )}
      </div>

      {erreur && (
        <p className="jr-texte-erreur jr-etat-detail" role="alert">
          {erreur}
        </p>
      )}
    </>
  );
}

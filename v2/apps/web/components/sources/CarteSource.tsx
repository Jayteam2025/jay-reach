'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Carte, Interrupteur, Puce, Tendance, TuileLogo } from '../ui';
import type { TuileLogoMarque } from '../ui';
import { actionActiverSourceCampagne } from '../../app/actions/sources';

export interface BlocCarteSource {
  readonly libelle: string;
  readonly contenu: ReactNode;
}

export interface CarteSourceProps {
  readonly campagneId: string;
  readonly sourceId: string;
  /** Un logo par fournisseur réel (R44) : la plupart des sources n'en ont qu'un, un thème hérité peut en avoir plusieurs. */
  readonly marques: TuileLogoMarque[];
  readonly titre: string;
  readonly sousTitre: string;
  readonly active: boolean;
  /** Faux pour les quatre types `linkedin_*` (lot 4) : puce à la place de l'interrupteur. */
  readonly collecteDisponible: boolean;
  readonly blocs: BlocCarteSource[];
  /** `null` masque le bloc « Retenus sur 7 jours » (pas de sens pour une source qui n'a jamais tourné). */
  readonly retenus7j: number[] | null;
}

/**
 * Carte d'une source (maquette `campagne-sources.html`) : en-tête (logo,
 * titre, statut, interrupteur, lien Modifier), puis une grille de petites
 * fiches (`blocs`, propres à chaque type de source — Requête/Filtres/Passages
 * pour Adzuna, Post suivi/On garde/Passages pour LinkedIn) et, sauf premier
 * passage, le graphe des sept derniers jours.
 */
export function CarteSource({
  campagneId,
  sourceId,
  marques,
  titre,
  sousTitre,
  active,
  collecteDisponible,
  blocs,
  retenus7j,
}: CarteSourceProps) {
  const t = useTranslations('campagne.sources.card');
  const [pending, startTransition] = useTransition();
  const [actif, setActif] = useState(active);

  function basculer(nouveau: boolean) {
    setActif(nouveau);
    startTransition(async () => {
      const res = await actionActiverSourceCampagne(campagneId, sourceId, nouveau);
      if (!res.ok) setActif(!nouveau);
    });
  }

  return (
    <Carte>
      <div className="jr-carte-h">
        <div className="jr-qui">
          {marques.length > 1 ? (
            <div className="jr-puces">
              {marques.map((m, i) => (
                <TuileLogo key={i} marque={m} taille="grande" />
              ))}
            </div>
          ) : (
            <TuileLogo marque={marques[0]!} taille="grande" />
          )}
          <span>
            <b>{titre}</b>
            <small>{sousTitre}</small>
          </span>
        </div>
        <div className="jr-carte-h-actions">
          <Puce ton={actif ? 'bon' : undefined} point>
            {actif ? t('active') : t('paused')}
          </Puce>
          {collecteDisponible ? (
            <Interrupteur
              actif={actif}
              onChange={basculer}
              disabled={pending}
              libelle={t('toggleAriaLabel')}
            />
          ) : (
            <Puce ton="attention" point>
              {t('pendingLot4')}
            </Puce>
          )}
          <Link
            href={`/campaigns/${campagneId}/sources?source=${sourceId}`}
            className="jr-bouton petit"
          >
            {t('modify')}
          </Link>
        </div>
      </div>
      <div className="jr-corps jr-blocs">
        {blocs.map((bloc, index) => (
          <div key={index}>
            <span className="jr-libelle">{bloc.libelle}</span>
            <div>{bloc.contenu}</div>
          </div>
        ))}
        {retenus7j && (
          <div>
            <span className="jr-libelle">{t('trend7d')}</span>
            <div className="jr-valeur-tendance">
              <b>{retenus7j.reduce((a, b) => a + b, 0)}</b>
              <Tendance valeurs={retenus7j} />
            </div>
          </div>
        )}
      </div>
    </Carte>
  );
}

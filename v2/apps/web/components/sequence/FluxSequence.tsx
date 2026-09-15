'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import type { VueSequence } from '@jay-reach/core';
import { TuileLogo, type TuileLogoMarque } from '../ui';
import { CarteEtape } from './CarteEtape';

export interface FluxSequenceProps {
  readonly campagneId: string;
  readonly vue: VueSequence;
}

function marqueDeProvider(providerId: string): TuileLogoMarque {
  if (providerId === 'adzuna') return 'adzuna';
  if (providerId === 'france_travail') return 'francetravail';
  return 'linkedin';
}

/** « 2 jours après » ou « 48 heures après » (un jour rond s'affiche en jours, sinon en heures). */
function delaiLibelle(t: ReturnType<typeof useTranslations>, heures: number): string {
  if (heures > 0 && heures % 24 === 0) return t('flow.delayDays', { n: heures / 24 });
  return t('flow.delayHours', { n: heures });
}

/**
 * Diagramme vertical de la séquence (maquette `campagne-sequence.html`) :
 * bloc Sources, une carte par étape avec le délai qui la sépare de la
 * précédente, puis la carte Fin de séquence.
 */
export function FluxSequence({ campagneId, vue }: FluxSequenceProps) {
  const t = useTranslations('campagne.sequence');
  const providers = [...new Set(vue.sources.map((s) => s.providerId))];

  return (
    <section className="jr-flux">
      <div className="jr-carte noeud">
        <div className="jr-qui">
          <TuileLogo marque="lettre" lettre="↓" />
          <span>
            <b>{t('flow.sourcesTitle')}</b>
            <small>{t('flow.sourcesSubtitle', { n: providers.length, m: vue.qualifies })}</small>
          </span>
        </div>
        <span className="jr-puces">
          {providers.map((p) => (
            <TuileLogo key={p} marque={marqueDeProvider(p)} />
          ))}
        </span>
      </div>

      <div className="fleche">{t('flow.intoSequence')}</div>

      {vue.etapes.map((etape, index) => (
        <Fragment key={etape.id}>
          {index > 0 && (
            <div className="jr-delai-ligne">
              <span />
              <span className="jr-delai">{delaiLibelle(t, etape.delaiHeures)}</span>
            </div>
          )}
          <CarteEtape campagneId={campagneId} etape={etape} />
        </Fragment>
      ))}

      <div className="fleche" />
      <div className="jr-carte noeud fin">
        <div className="jr-qui">
          <span className="jr-tuile-logo fin">
            <svg viewBox="0 0 24 24">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </span>
          <span>
            <b>{t('flow.endTitle')}</b>
            <small>{t('flow.endText', { n: vue.finDeSequence.termines })}</small>
          </span>
        </div>
      </div>
    </section>
  );
}

'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import type { VueSequence } from '@jay-reach/core';
import { TuileLogo } from '../ui';
import { marqueSource } from '../../lib/marque-source';
import { dateCourte, FUSEAU_PAR_DEFAUT } from '../../lib/dates';
import { CarteEtape } from './CarteEtape';
import { avertissementsSequence } from './avertissements-sequence';

export interface FluxSequenceProps {
  readonly campagneId: string;
  readonly vue: VueSequence;
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
  // Ce que cette séquence ne pourra pas faire, dit AVANT le lancement : sans cela, l'opérateur
  // ne l'apprend qu'action par action dans le journal, une fois la campagne partie.
  const avertissements = avertissementsSequence(vue.etapes);

  return (
    <section className="jr-flux">
      {avertissements.length > 0 && (
        <div className="jr-avertissement">
          {avertissements.map((a) => (
            <p key={a.cle}>{t(`avertissements.${a.cle}`, { n: a.position })}</p>
          ))}
        </div>
      )}
      {vue.listeSource ? (
        // Campagne à liste (point 2, issue #120 ; revue F5, constat bloquant 1) : même texte
        // que la carte Sources de la vue d'ensemble, jamais « 0 source alimente cette
        // campagne, 0 contact qualifié » qui n'a aucun sens sans thème de veille.
        <div className="jr-carte noeud">
          <div className="jr-qui">
            <TuileLogo marque="lettre" lettre={vue.listeSource.nom.charAt(0).toUpperCase()} />
            <span>
              <b>{vue.listeSource.nom}</b>
              <small>
                {t('flow.sourcesListSubtitle', {
                  n: vue.listeSource.contacts,
                  date: dateCourte(vue.listeSource.importeeLe, new Date(), FUSEAU_PAR_DEFAUT),
                })}
              </small>
            </span>
          </div>
        </div>
      ) : (
        <div className="jr-carte noeud">
          <div className="jr-qui">
            <TuileLogo marque="lettre" lettre="↓" />
            <span>
              <b>{t('flow.sourcesTitle')}</b>
              <small>{t('flow.sourcesSubtitle', { n: providers.length, m: vue.qualifies })}</small>
            </span>
          </div>
          <span className="jr-puces">
            {providers.map((p, index) => (
              <TuileLogo key={p ?? `inconnu-${index}`} marque={marqueSource(p)} lettre={p ? undefined : '?'} />
            ))}
          </span>
        </div>
      )}

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

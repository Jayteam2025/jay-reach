'use client';

import { useTranslations } from 'next-intl';
import type { FichePourquoi, FicheScore } from '@jay-reach/core';
import { TuileLogo, type TuileLogoMarque } from '../ui';
import { marqueSource } from '../../lib/marque-source';
import { dateCourte } from '../../lib/dates';

export interface SectionPourquoiLuiProps {
  pourquoi: FichePourquoi | null;
  score: FicheScore | null;
  fuseau: string;
}

/** Nom d'affichage des trois fournisseurs connus — `providerId` sinon (jamais vide). */
const NOM_FOURNISSEUR: Record<string, string> = {
  adzuna: 'Adzuna',
  francetravail: 'France Travail',
  linkedin: 'LinkedIn',
};

function nomFournisseur(providerId: string | null): string | null {
  if (!providerId) return null;
  return NOM_FOURNISSEUR[providerId] ?? providerId;
}

export function SectionPourquoiLui({ pourquoi, score, fuseau }: SectionPourquoiLuiProps) {
  const t = useTranslations('campagne.fiche');

  return (
    <>
      <h4>{t('sections.why')}</h4>
      {pourquoi ? (
        <>
          <div className="jr-qui" style={{ alignItems: 'flex-start' }}>
            <span className="jr-tuile-logo">
              <TuileLogo marque={marqueSource(pourquoi.providerId) as TuileLogoMarque} lettre={(pourquoi.providerId ?? '?').slice(0, 1).toUpperCase()} />
            </span>
            <span style={{ whiteSpace: 'normal' }}>
              <b style={{ fontWeight: 600 }}>{pourquoi.titre ?? '—'}</b>
              <small style={{ whiteSpace: 'normal' }}>
                {[nomFournisseur(pourquoi.providerId), pourquoi.date ? dateCourte(pourquoi.date, undefined, fuseau) : null]
                  .filter(Boolean)
                  .join(' · ')}
                {pourquoi.url && (
                  <>
                    {' · '}
                    <a className="jr-lien" href={pourquoi.url} target="_blank" rel="noreferrer">
                      {t('why.link')}
                    </a>
                  </>
                )}
              </small>
            </span>
          </div>
          {score && (
            <p style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              {t('score', { n: score.valeur })}
              {score.explication ? ` : ${score.explication}` : ''}
            </p>
          )}
          {pourquoi.extrait && (
            <p className="jr-secondaire" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              {pourquoi.extrait}
            </p>
          )}
        </>
      ) : (
        <p className="jr-secondaire">{t('why.empty')}</p>
      )}
    </>
  );
}

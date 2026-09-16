'use client';

import { useTranslations } from 'next-intl';
import type { FicheSequence } from '@jay-reach/core';

export interface SectionOuEnEstOnProps {
  sequence: FicheSequence | null;
}

/** `.jr-sequence-pilules .pilule[.faite|.en-cours]` — pas de puce dédiée pour « à venir » (classe nue), même kit que `CarteEtape` (tâche 12). */
function classePilule(etat: FicheSequence['etapes'][number]['etat']): string {
  if (etat === 'faite') return 'pilule faite';
  if (etat === 'en_cours') return 'pilule en-cours';
  return 'pilule';
}

export function SectionOuEnEstOn({ sequence }: SectionOuEnEstOnProps) {
  const t = useTranslations('campagne.fiche');

  return (
    <>
      <h4>{t('sections.whereAreWe')}</h4>
      {sequence ? (
        <>
          <div className="jr-sequence-pilules">
            {sequence.etapes.map((e) => (
              <span key={e.position} className={classePilule(e.etat)}>
                {t('sequence.step', { n: e.position })}
              </span>
            ))}
          </div>
          {sequence.boite && (
            <p className="jr-secondaire" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              {t('sequence.sentBy', { boite: sequence.boite.identite })}
            </p>
          )}
        </>
      ) : (
        <p className="jr-secondaire">{t('sequence.empty')}</p>
      )}
    </>
  );
}

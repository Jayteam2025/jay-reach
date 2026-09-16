'use client';

import { useTranslations } from 'next-intl';
import type { Evenement } from '@jay-reach/core';
import { Journal } from '../ui';
import { dateCourte } from '../../lib/dates';

export interface SectionHistoriqueProps {
  historique: Evenement[];
  fuseau: string;
}

export function SectionHistorique({ historique, fuseau }: SectionHistoriqueProps) {
  const t = useTranslations('campagne.fiche');

  return (
    <>
      <h4>{t('sections.history')}</h4>
      {historique.length === 0 ? (
        <p className="jr-secondaire" style={{ fontSize: 13.5 }}>
          {t('history.empty')}
        </p>
      ) : (
        <Journal
          entrees={historique.map((e) => ({
            heure: dateCourte(e.quand, undefined, fuseau),
            texte: e.libelle || e.type,
            note: e.detail ?? undefined,
          }))}
        />
      )}
    </>
  );
}

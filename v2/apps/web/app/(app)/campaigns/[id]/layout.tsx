import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { lireVueDEnsemble } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { EnTeteCampagne } from '../../../../components/campagne/EnTeteCampagne';
import { OngletsCampagne } from '../../../../components/campagne/OngletsCampagne';
import { BoutonLancerPause } from '../../../../components/campagne/BoutonLancerPause';

/**
 * En-tête et onglets communs aux sept écrans d'une campagne. Ne charge que
 * `campagne` (l'en-tête) — chaque onglet relit lui-même le reste de
 * `lireVueDEnsemble`/les autres fonctions de campagne pour son propre besoin
 * (pas de calque commun qui figerait le fetch de la Vue d'ensemble pour tous
 * les onglets).
 */
export default async function CampagneLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, vue] = await Promise.all([getTranslations('campagne'), lireVueDEnsemble(ctx, { campagneId: id })]);

  return (
    <>
      <EnTeteCampagne
        campagne={vue.campagne}
        libelles={{
          filAriane: t('header.breadcrumb'),
          statut: t(`status.${vue.campagne.statut}`),
          modifier: t('header.edit'),
          envoieDepuis: t('header.sendingFrom'),
        }}
        action={<BoutonLancerPause campagneId={vue.campagne.id} statut={vue.campagne.statut} />}
        onglets={
          <OngletsCampagne
            campagneId={id}
            compteurs={{ contacts: vue.entonnoir.qualifies, fileDuJour: vue.fileDuJour.length, sources: vue.sources.length }}
          />
        }
      />
      {children}
    </>
  );
}

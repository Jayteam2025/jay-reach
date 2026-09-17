import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../lib/campagne';
import { EnTeteCampagne } from '../../../../components/campagne/EnTeteCampagne';
import { OngletsCampagne } from '../../../../components/campagne/OngletsCampagne';
import { BoutonLancerPause } from '../../../../components/campagne/BoutonLancerPause';

/**
 * En-tête et onglets communs aux sept écrans d'une campagne. Ne charge que
 * `campagne` (l'en-tête) — chaque onglet relit lui-même le reste de
 * `lireVueDEnsemble`/les autres fonctions de campagne pour son propre besoin
 * (pas de calque commun qui figerait le fetch de la Vue d'ensemble pour tous
 * les onglets). `lireVueDEnsembleCourante` (mémoïsée, `lib/campagne.ts`) fait
 * qu'un même rendu ne relit ces six requêtes qu'une fois, malgré le second
 * appel identique de la page Vue d'ensemble (tour de correction 1).
 *
 * `notFound()` : le `not-found.tsx` qui capte cet appel vit à
 * `campaigns/not-found.tsx` (le segment PARENT), pas à côté de ce layout —
 * dans l'App Router, le `not-found.tsx` d'un segment enveloppe ses enfants
 * (page, segments imbriqués), jamais le `layout.tsx` du même segment (le
 * layout est justement ce qui enveloppe cette frontière). Un `not-found.tsx`
 * posé ici n'aurait donc jamais rattrapé CET appel.
 */
export default async function CampagneLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteCourant();

  let t: Awaited<ReturnType<typeof getTranslations>>;
  let vue: Awaited<ReturnType<typeof lireVueDEnsembleCourante>>;
  try {
    [t, vue] = await Promise.all([getTranslations('campagne'), lireVueDEnsembleCourante(ctx, id)]);
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }

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
            compteurs={{
              // Point 2 : une campagne à liste n'a pas de « contacts qualifiés » (aucun
              // signal), le badge de l'onglet Contacts prend alors les contacts importés —
              // même population que l'onglet lui-même dans les deux cas.
              contacts: vue.entonnoir.origine === 'sources' ? vue.entonnoir.contacts : vue.entonnoir.contactsImportes,
              fileDuJour: vue.fileDuJour.length,
              sources: vue.nombreSources,
            }}
          />
        }
      />
      {children}
    </>
  );
}

import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { lireSequence, apercuEtape, ErreurIntrouvable } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { EtatVide } from '../../../../../components/ui';
import { FluxSequence } from '../../../../../components/sequence/FluxSequence';
import { TiroirEtape } from '../../../../../components/sequence/TiroirEtape';

export const revalidate = 0;

export default async function CampagneSequencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp, vue] = await Promise.all([
    getTranslations('campagne.sequence'),
    searchParams,
    lireSequence(ctx, { campagneId: id }),
  ]);

  const brutAjouter = Array.isArray(sp.ajouter) ? sp.ajouter[0] : sp.ajouter;
  const brutEtape = Array.isArray(sp.etape) ? sp.etape[0] : sp.etape;

  let tiroir: ReactNode = null;
  if (brutEtape) {
    const etape = vue.etapes.find((e) => e.id === brutEtape);
    if (etape) {
      // Défensif : `etape` vient de `vue.etapes` (déjà filtré par organisation),
      // `apercuEtape` ne devrait donc jamais la manquer — mais une étape
      // supprimée entre les deux lectures ne doit pas faire tomber la page,
      // seulement priver le tiroir de son aperçu.
      let apercu: { sujet: string; corps: string } | null = null;
      try {
        const resultat = await apercuEtape(ctx, { etapeId: etape.id });
        apercu = resultat.corps ? resultat : null;
      } catch (err) {
        if (!(err instanceof ErreurIntrouvable)) throw err;
      }
      tiroir = (
        <TiroirEtape
          campagneId={id}
          etape={{
            id: etape.id,
            position: etape.position,
            titre: etape.titre,
            canal: etape.canal,
            sujet: etape.sujet ?? '',
            corps: etape.corps,
            delaiHeures: etape.delaiHeures,
            passes: etape.passes,
            repondusTotal: etape.repondusIci.total,
          }}
          apercu={apercu}
        />
      );
    }
  } else if (brutAjouter === '1') {
    tiroir = <TiroirEtape campagneId={id} etape={null} apercu={null} />;
  }

  return (
    <>
      <div className="jr-flux-entete">
        <div className="jr-section-entete">
          <div>
            <h2>{t('title')}</h2>
            <p>{t('description')}</p>
          </div>
          <Link href={`/campaigns/${id}/sequence?ajouter=1`} className="jr-bouton principal">
            {t('add')}
          </Link>
        </div>
      </div>

      {vue.etapes.length === 0 ? (
        <div className="jr-flux-entete">
          <EtatVide titre={t('empty.title')} texte={t('empty.text')} />
        </div>
      ) : (
        <FluxSequence campagneId={id} vue={vue} />
      )}

      {tiroir}
    </>
  );
}

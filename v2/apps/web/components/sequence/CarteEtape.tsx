'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { EtapeVue } from '@jay-reach/core';
import { Avatar, Puce, TuileLogo } from '../ui';

export interface CarteEtapeProps {
  readonly campagneId: string;
  readonly etape: EtapeVue;
}

/**
 * Une étape de la séquence (maquette `campagne-sequence.html`) : carte
 * message (canal, aperçu du corps, contacts passés, lien Modifier) et, à
 * côté, la carte « Ont répondu ici » quand au moins un contact a répondu
 * précisément à cette étape.
 *
 * Seules les étapes email s'éditent depuis ce tiroir (R19 / en-tête de
 * `packages/core/src/fonctions/sequence.ts`) : une carte LinkedIn n'a pas de
 * lien Modifier.
 */
export function CarteEtape({ campagneId, etape }: CarteEtapeProps) {
  const t = useTranslations('campagne.sequence');
  const modifiable = etape.canal === 'email';

  return (
    <div className="jr-etape">
      <span className="numero">{etape.position}</span>
      <div className="jr-carte carte">
        <div className="entete">
          <TuileLogo marque={etape.canal === 'linkedin' ? 'linkedin' : 'email'} />
          <span>
            <b>{etape.titre}</b>
            <small>
              {t('card.step', { n: etape.position })}
              {etape.position === 1 && modifiable ? ` · ${t('card.salesblinkNotice')}` : ''}
            </small>
          </span>
        </div>
        <div className="apercu">
          {etape.corps ? (
            <>
              {etape.sujet && <b>{etape.sujet}</b>}
              {etape.corps}
            </>
          ) : (
            t('card.noMessage')
          )}
        </div>
        <div className="pied">
          <span>{t('card.passedThrough', { n: etape.passes })}</span>
          {modifiable ? (
            <Link href={`/campaigns/${campagneId}/sequence?etape=${etape.id}`} className="jr-lien">
              {t('card.modify')}
            </Link>
          ) : (
            <span className="jr-secondaire">{t('card.linkedinNotice')}</span>
          )}
        </div>
      </div>
      {etape.repondusIci.total > 0 && (
        <div className="jr-carte sorties">
          <Puce ton="bon" point>
            {t('card.repliedHere')}
          </Puce>
          <b>{etape.repondusIci.total}</b>
          {t('card.leftSequence', { n: etape.repondusIci.total })}
          <div className="jr-pile">
            {etape.repondusIci.contacts.map((c, i) => (
              <Avatar key={i} nom={c.nom} photoUrl={c.photoUrl} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

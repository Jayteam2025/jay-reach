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
 * Les étapes email ET LinkedIn s'éditent depuis ce tiroir (R48, tour de
 * correction 1 : une campagne réelle alterne déjà les deux) — seule
 * l'EXÉCUTION d'une étape LinkedIn (l'envoi réel) reste pilotée côté serveur
 * (lot 4, pas encore livré), signalé en sous-titre plutôt que par l'absence
 * du lien Modifier.
 */
export function CarteEtape({ campagneId, etape }: CarteEtapeProps) {
  const t = useTranslations('campagne.sequence');

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
              {etape.canal === 'linkedin' && ` · ${t('card.linkedinNotice')}`}
              {etape.canal === 'email' && etape.position === 1 && ` · ${t('card.salesblinkNotice')}`}
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
          <Link href={`/campaigns/${campagneId}/sequence?etape=${etape.id}`} className="jr-lien">
            {t('card.modify')}
          </Link>
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

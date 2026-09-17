'use client';

import { useTranslations } from 'next-intl';
import type { FicheSequence } from '@jay-reach/core';
import { libelleMotifPause } from '../../lib/motif-pause';
import { BoutonReprendre } from '../campagne/BoutonReprendre';

export interface SectionOuEnEstOnProps {
  sequence: FicheSequence | null;
  /**
   * Requis pour proposer « Reprendre » sur une pause (T29, R93) — `null` hors
   * d'une campagne (fiche globale, `apps/web/app/(app)/contacts/page.tsx`,
   * qui appelle `lireFiche` sans `campagneId` : `sequence.pause` y est alors
   * toujours nul, donc le bouton ne s'affiche jamais dans ce cas).
   */
  campagneId: string | null;
}

/** `.jr-sequence-pilules .pilule[.faite|.en-cours]` — pas de puce dédiée pour « à venir » (classe nue), même kit que `CarteEtape` (tâche 12). */
function classePilule(etat: FicheSequence['etapes'][number]['etat']): string {
  if (etat === 'faite') return 'pilule faite';
  if (etat === 'en_cours') return 'pilule en-cours';
  return 'pilule';
}

export function SectionOuEnEstOn({ sequence, campagneId }: SectionOuEnEstOnProps) {
  const t = useTranslations('campagne.fiche');
  const tPause = useTranslations('campagne.contacts.pause');
  const tActions = useTranslations('campagne.contacts.actions');

  const motifAffiche = sequence?.pause
    ? libelleMotifPause(sequence.pause.motif, sequence.pause.repriseLe, (cle, valeurs) => tPause(cle, valeurs))
    : null;

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
          {sequence.pause && motifAffiche && campagneId && (
            <p className="jr-secondaire" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
              {t('sequence.pausedLine', { motif: motifAffiche.texte })}{' '}
              <BoutonReprendre
                inscriptionId={sequence.pause.inscriptionId}
                campagneId={campagneId}
                libelle={sequence.pause.motif === 'absence' ? tActions('resumeNow') : tActions('resume')}
              />
            </p>
          )}
        </>
      ) : (
        <p className="jr-secondaire">{t('sequence.empty')}</p>
      )}
    </>
  );
}

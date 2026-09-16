'use client';

import { useTranslations } from 'next-intl';
import type { MessageFicheContact } from '@jay-reach/core';
import { Message } from '../ui';

export interface SectionEchangesProps {
  echanges: MessageFicheContact[];
  filId: string | null;
  contactNom: string;
  fuseau: string;
}

function dateCourte(iso: string | null, fuseau: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: fuseau }).format(new Date(iso));
}

/**
 * `MessageFicheContact` (spec §6.10) ne porte pas le nom de l'auteur d'un message
 * sortant (aucune boîte n'est enregistrée par message, seule la dernière
 * connue de la séquence l'est — `FicheSequence.boite`) : un message sortant
 * affiche un libellé générique, un message entrant le nom du contact.
 */
export function SectionEchanges({ echanges, filId, contactNom, fuseau }: SectionEchangesProps) {
  const t = useTranslations('campagne.fiche');

  return (
    <>
      <h4>
        {t('sections.conversation')}
        {filId && (
          <span>
            {' '}
            <a className="jr-lien" href="/inbox">
              {t('conversation.openInInbox')}
            </a>
          </span>
        )}
      </h4>
      {echanges.length === 0 ? (
        <p className="jr-secondaire">{t('conversation.empty')}</p>
      ) : (
        echanges.map((m) => (
          <Message
            key={m.id}
            direction={m.direction === 'in' ? 'entrant' : 'sortant'}
            auteur={m.direction === 'in' ? contactNom : t('conversation.outbound')}
            date={dateCourte(m.quand, fuseau)}
            corps={m.corps ?? ''}
          />
        ))
      )}
    </>
  );
}

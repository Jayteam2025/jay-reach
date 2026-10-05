'use client';

import { useTranslations } from 'next-intl';
import type { FicheContact } from '@jay-reach/core';
import { CleValeur, Puce } from '../ui';
import { BoutonChercherEmailContact } from './BoutonChercherEmailContact';

export interface SectionCoordonneesProps {
  contact: FicheContact;
  /**
   * `true` quand `enrichissements_par_jour` (réglages de l'organisation) vaut 0 (constat
   * produit, 18/09, tour de correction G4) : état de L'INSTANCE, chargé une fois par la page
   * appelante (`lireReglages`, déjà lu pour le fuseau) et transmis ici — jamais une requête
   * propre à cette section. Voir `BoutonChercherEmail.raisonIndisponible` (même garde-fou).
   */
  enrichissementEnPause: boolean;
}

export function SectionCoordonnees({ contact, enrichissementEnPause }: SectionCoordonneesProps) {
  const t = useTranslations('campagne.fiche');

  return (
    <>
      <h4>{t('sections.contactInfo')}</h4>
      <CleValeur
        libelle={t('contactInfo.email')}
        valeur={
          contact.email ? (
            <>
              {contact.email}
              {contact.emailStatut === 'valid' && (
                <Puce ton="bon" point>
                  {t('contactInfo.emailVerified')}
                </Puce>
              )}
            </>
          ) : (
            <BoutonChercherEmailContact
              contactId={contact.id}
              libelle={t('contactInfo.findEmail')}
              cout={t('contactInfo.findEmailCost')}
              raisonIndisponible={enrichissementEnPause ? t('contactInfo.findEmailPaused') : null}
            />
          )
        }
      />
      {/* Aucune colonne de téléphone dans le schéma (`FicheContact.telephone` reste `null`) :
          affiché ici en toute franchise plutôt qu'un lien « Chercher » qu'aucune fonction ne
          rend encore (hors périmètre de cette tâche, qui ne porte que sur l'email). */}
      <CleValeur libelle={t('contactInfo.phone')} valeur={contact.telephone ?? t('contactInfo.phoneUnavailable')} />
      <CleValeur
        libelle={t('contactInfo.linkedin')}
        valeur={
          contact.linkedinUrl ? (
            <a className="jr-lien" href={contact.linkedinUrl} target="_blank" rel="noreferrer">
              {contact.linkedinUrl}
            </a>
          ) : (
            '—'
          )
        }
      />
    </>
  );
}

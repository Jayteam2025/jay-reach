import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import type { CampagneFil, PourquoiLuiFil, ResumeContactFil } from '@jay-reach/core';
import { Avatar, Puce, TuileLogo } from '../ui';
import { IconeLinkedin } from '../ui/IconeLinkedin';
import { marqueSource } from '../../lib/marque-source';

export interface ColonneContactProps {
  /** Résolu une fois par `page.tsx` — voir le commentaire équivalent dans `Fil.tsx`. */
  readonly t: Awaited<ReturnType<typeof getTranslations>>;
  readonly contact: ResumeContactFil;
  readonly canal: 'email' | 'linkedin';
  readonly campagne: CampagneFil | null;
  readonly pourquoi: PourquoiLuiFil | null;
  readonly pourquoiQuandAffiche: string | null;
}

function puceStatutEmail(statut: string | null, t: Awaited<ReturnType<typeof getTranslations>>): { ton: 'bon' | 'attention' | 'erreur'; texte: string } | null {
  if (statut === 'valid') return { ton: 'bon', texte: t('colonne.emailVerifie') };
  if (statut === 'risky') return { ton: 'attention', texte: t('colonne.emailRisque') };
  if (statut === 'invalid') return { ton: 'erreur', texte: t('colonne.emailInvalide') };
  return null;
}

/**
 * Colonne droite : résumé de la fiche, alimenté par ce que `lireFil` sait déjà
 * (pas d'appel à `lireFiche`, tâche 17, pas encore construite). « Ouvrir la
 * fiche complète » pointe déjà vers `/contacts?contact=<id>` (URL prévue par
 * le plan de la tâche 17) : le lien devient actif dès que cette page existe,
 * rien à changer ici.
 */
export function ColonneContact({ t, contact, canal, campagne, pourquoi, pourquoiQuandAffiche }: ColonneContactProps) {
  const marque = marqueSource(pourquoi?.providerId ?? null);
  const statutEmail = puceStatutEmail(contact.emailStatut, t);

  return (
    <aside className="jr-colonne">
      <div className="jr-qui">
        <Avatar nom={contact.nom} taille="grand" canal={canal} />
        <span>
          <h3>{contact.nom}</h3>
          <small>{[contact.poste, contact.entreprise].filter(Boolean).join(' · ')}</small>
        </span>
      </div>

      <h4>{t('colonne.pourquoiLui')}</h4>
      {pourquoi ? (
        <div className="jr-qui" style={{ alignItems: 'flex-start' }}>
          <TuileLogo marque={marque} lettre="?" />
          <p>
            {pourquoi.titre}
            {pourquoiQuandAffiche ? ` — ${pourquoiQuandAffiche}` : ''}
            {pourquoi.score !== null ? ` · ${t('colonne.score', { valeur: pourquoi.score })}` : ''}
          </p>
        </div>
      ) : (
        <p className="jr-secondaire">{t('colonne.aucunSignal')}</p>
      )}

      <h4>{t('colonne.ouEnEstOn')}</h4>
      {campagne?.etape ? (
        <>
          <div className="jr-sequence-pilules">
            {Array.from({ length: campagne.etape.total }, (_, i) => (
              <span key={i} className={i < campagne.etape!.position ? 'pilule faite' : 'pilule'}>
                {i + 1}
              </span>
            ))}
          </div>
          <p style={{ marginTop: 6 }}>
            {t('colonne.etapeResume', { position: campagne.etape.position, total: campagne.etape.total })}
            {campagne.sequenceArretee ? `, ${t('fil.sequenceArretee')}.` : '.'}
          </p>
        </>
      ) : (
        <p className="jr-secondaire">{t('colonne.aucuneSequence')}</p>
      )}

      <h4>{t('colonne.coordonnees')}</h4>
      {contact.email ? (
        <p>
          {contact.email} {statutEmail && <Puce ton={statutEmail.ton} point>{statutEmail.texte}</Puce>}
        </p>
      ) : (
        <p className="jr-secondaire">{t('colonne.emailAbsent')}</p>
      )}
      {contact.linkedinUrl && (
        <p style={{ marginTop: 4 }}>
          <IconeLinkedin className="jr-ico-li" />{' '}
          <a className="jr-lien" href={contact.linkedinUrl} target="_blank" rel="noreferrer">
            {t('colonne.profilLinkedin')}
          </a>
        </p>
      )}

      <h4>{t('colonne.notes')}</h4>
      <p className="jr-secondaire">{t('colonne.aucuneNote')}</p>

      {contact.id && (
        <p style={{ marginTop: 18 }}>
          <Link className="jr-lien" href={`/contacts?contact=${contact.id}`}>
            {t('colonne.ouvrirFiche')}
          </Link>
        </p>
      )}
    </aside>
  );
}

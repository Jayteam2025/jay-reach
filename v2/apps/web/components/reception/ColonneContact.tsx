import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import type { Fiche } from '@jay-reach/core';
import { Avatar, Puce, TuileLogo, type TuileLogoMarque } from '../ui';
import { IconeLinkedin } from '../ui/IconeLinkedin';
import { marqueSource } from '../../lib/marque-source';

export interface ColonneContactProps {
  /** Résolu une fois par `page.tsx` — voir le commentaire équivalent dans `Fil.tsx`. */
  readonly t: Awaited<ReturnType<typeof getTranslations>>;
  /** Résumé assemblé par `lireFiche` (tâche 17) — plus le résumé provisoire construit depuis `lireFil` seul. */
  readonly fiche: Fiche;
  readonly canal: 'email' | 'linkedin';
  /**
   * Campagne DU FIL affiché (pas forcément la même que celle utilisée pour
   * calculer `fiche.statut`/`fiche.sequence` si `lireFiche` a été appelée
   * sans campagne — voir `page.tsx`) : sert au lien « Ouvrir la fiche
   * complète » (`/campaigns/{id}/contacts?contact=`, même mécanisme que la
   * tâche 17). `null` si le fil n'est rattaché à aucune campagne — pas de
   * lien alors, faute d'une page Contacts globale (tâche 18).
   */
  readonly campagneId: string | null;
  readonly pourquoiQuandAffiche: string | null;
}

function puceStatutEmail(
  statut: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { ton: 'bon' | 'attention' | 'erreur'; texte: string } | null {
  if (statut === 'valid') return { ton: 'bon', texte: t('colonne.emailVerifie') };
  if (statut === 'risky') return { ton: 'attention', texte: t('colonne.emailRisque') };
  if (statut === 'invalid') return { ton: 'erreur', texte: t('colonne.emailInvalide') };
  return null;
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

/**
 * Position 1-based courante dans la séquence : l'étape « en_cours » si la
 * séquence est vivante, sinon le nombre d'étapes déjà faites (séquence
 * arrêtée — arrivée à la réponse, par exemple).
 */
function positionCourante(sequence: Fiche['sequence']): number {
  if (!sequence) return 0;
  const enCours = sequence.etapes.find((e) => e.etat === 'en_cours');
  if (enCours) return enCours.position;
  return sequence.etapes.filter((e) => e.etat === 'faite').length;
}

/**
 * Colonne droite de la Réception (spec §6.12, maquette `reception.html`) :
 * résumé de la fiche, alimenté par `lireFiche` (tâche 17, R75 — remplace le
 * résumé provisoire construit depuis `lireFil` seul, qui reste inchangée par
 * ailleurs : `FilDetail`/`Fil.tsx` continuent de porter le fil complet des
 * messages, hors périmètre de cette colonne).
 *
 * Composition volontairement indépendante des sections du tiroir
 * (`components/contact/Section*.tsx`) : celles-ci appellent `useTranslations`
 * directement (React Context, nécessite un `NextIntlClientProvider` — fourni
 * par le layout racine en production, absent d'un rendu `renderToStaticMarkup`
 * isolé) alors que tous les composants de ce dossier reçoivent leur
 * traducteur en prop, résolu une fois par `page.tsx` — même convention que
 * `Fil.tsx`/`ListeFils.tsx`, qui reste testable sans fournisseur de contexte.
 * Pas de notes éditables ici (lecture seule, comme la maquette) : le geste
 * d'ajouter une note vit dans la fiche complète, un clic plus loin.
 */
export function ColonneContact({ t, fiche, canal, campagneId, pourquoiQuandAffiche }: ColonneContactProps) {
  const marque = marqueSource(fiche.pourquoi?.providerId ?? null);
  const statutEmail = puceStatutEmail(fiche.contact.emailStatut, t);
  const nom = nomComplet(fiche.contact.prenom, fiche.contact.nom);
  // `en_pause` exclu au même titre qu'`en_sequence` (tour de correction 1,
  // Important de la relecture, T29) : une inscription simplement en pause
  // (gate email, expéditeur indisponible, absence…) est reprenable, pas
  // arrêtée — avant T29, `paused`/`paused_absence` tombaient dans le statut
  // dérivé `en_sequence`, donc `sequenceArretee` valait déjà `false` pour ces
  // inscriptions ; le nouveau statut `en_pause` doit se comporter pareil.
  const sequenceArretee =
    fiche.sequence !== null &&
    fiche.statut !== 'en_sequence' &&
    fiche.statut !== 'en_pause' &&
    fiche.sequence.etapes.some((e) => e.etat === 'faite');

  return (
    <aside className="jr-colonne">
      <div className="jr-qui">
        <Avatar nom={nom} photoUrl={fiche.contact.photoUrl} taille="grand" canal={canal} />
        <span>
          <h3>{nom}</h3>
          <small>{[fiche.contact.poste, fiche.contact.entreprise].filter(Boolean).join(' · ')}</small>
        </span>
      </div>

      <h4>{t('colonne.pourquoiLui')}</h4>
      {fiche.pourquoi ? (
        <div className="jr-qui" style={{ alignItems: 'flex-start' }}>
          <TuileLogo marque={marque as TuileLogoMarque} lettre="?" />
          <p>
            {fiche.pourquoi.titre}
            {pourquoiQuandAffiche ? ` — ${pourquoiQuandAffiche}` : ''}
            {fiche.score !== null ? ` · ${t('colonne.score', { valeur: fiche.score.valeur })}` : ''}
          </p>
        </div>
      ) : (
        <p className="jr-secondaire">{t('colonne.aucunSignal')}</p>
      )}

      <h4>{t('colonne.ouEnEstOn')}</h4>
      {fiche.sequence && fiche.sequence.etapes.length > 0 ? (
        <>
          <div className="jr-sequence-pilules">
            {fiche.sequence.etapes.map((e) => (
              <span key={e.position} className={e.etat === 'a_venir' ? 'pilule' : `pilule ${e.etat === 'faite' ? 'faite' : 'en-cours'}`}>
                {e.position}
              </span>
            ))}
          </div>
          <p style={{ marginTop: 6 }}>
            {t('colonne.etapeResume', { position: positionCourante(fiche.sequence), total: fiche.sequence.etapes.length })}
            {sequenceArretee ? `, ${t('fil.sequenceArretee')}.` : '.'}
          </p>
        </>
      ) : (
        <p className="jr-secondaire">{t('colonne.aucuneSequence')}</p>
      )}

      <h4>{t('colonne.coordonnees')}</h4>
      {fiche.contact.email ? (
        <p>
          {fiche.contact.email} {statutEmail && <Puce ton={statutEmail.ton} point>{statutEmail.texte}</Puce>}
        </p>
      ) : (
        <p className="jr-secondaire">{t('colonne.emailAbsent')}</p>
      )}
      {fiche.contact.linkedinUrl && (
        <p style={{ marginTop: 4 }}>
          <IconeLinkedin className="jr-ico-li" />{' '}
          <a className="jr-lien" href={fiche.contact.linkedinUrl} target="_blank" rel="noreferrer">
            {t('colonne.profilLinkedin')}
          </a>
        </p>
      )}

      <h4>{t('colonne.notes')}</h4>
      {fiche.notes.length > 0 ? (
        fiche.notes.map((n) => (
          <p key={n.id} className="jr-secondaire" style={{ marginBottom: 6 }}>
            {n.texte}
          </p>
        ))
      ) : (
        <p className="jr-secondaire">{t('colonne.aucuneNote')}</p>
      )}

      {campagneId && (
        <p style={{ marginTop: 18 }}>
          <Link className="jr-lien" href={`/campaigns/${campagneId}/contacts?contact=${fiche.contact.id}`}>
            {t('colonne.ouvrirFiche')}
          </Link>
        </p>
      )}
    </aside>
  );
}

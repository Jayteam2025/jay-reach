'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Fiche } from '@jay-reach/core';
import { Avatar, Puce, Tiroir } from '../ui';
import { IconeLinkedin } from '../ui/IconeLinkedin';
import { TON_STATUT } from '../campagne/TableContacts';
import { BoutonEcarterContact } from '../campagne/BoutonEcarterContact';
import { BoutonNePlusContacter } from './BoutonNePlusContacter';
import { SectionPourquoiLui } from './SectionPourquoiLui';
import { SectionOuEnEstOn } from './SectionOuEnEstOn';
import { SectionEchanges } from './SectionEchanges';
import { SectionCoordonnees } from './SectionCoordonnees';
import { SectionNotes } from './SectionNotes';
import { SectionHistorique } from './SectionHistorique';

export interface TiroirFicheProps {
  fiche: Fiche;
  /** Absent hors d'une campagne (tâche 18, table globale) : le bouton « Écarter de la campagne » disparaît alors. */
  campagneId?: string;
  fuseau: string;
  /** URL de la page courante SANS `?contact=` — le bouton fermer/le voile y renvoient. */
  fermerHref: string;
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

export function TiroirFiche({ fiche, campagneId, fuseau, fermerHref }: TiroirFicheProps) {
  const router = useRouter();
  const t = useTranslations('campagne');
  const nom = nomComplet(fiche.contact.prenom, fiche.contact.nom);
  // La pastille de l'avatar reflète le canal d'origine (le signal qui a fait naître le contact,
  // maquette `fiche-contact.html`), pas la simple présence d'un lien LinkedIn sur la fiche.
  const canal = fiche.pourquoi?.providerId === 'linkedin' ? 'linkedin' : 'email';

  function fermer() {
    router.push(fermerHref);
  }

  return (
    <Tiroir
      ouvert
      taille="large"
      onFermer={fermer}
      libelleFermer={t('fiche.close')}
      icone={<Avatar nom={nom} photoUrl={fiche.contact.photoUrl} taille="xl" canal={canal} />}
      titre={
        <>
          {nom}
          {fiche.contact.linkedinUrl && (
            <a href={fiche.contact.linkedinUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
              <IconeLinkedin className="jr-ico-li" />
            </a>
          )}
        </>
      }
      description={[fiche.contact.poste, fiche.contact.entreprise, fiche.contact.ville].filter(Boolean).join(' · ') || undefined}
      puces={
        <>
          <Puce ton={TON_STATUT[fiche.statut]} point>
            {t(`contacts.status.${fiche.statut}`)}
          </Puce>
          {fiche.score && <Puce>{t('fiche.score', { n: fiche.score.valeur })}</Puce>}
          {fiche.campagnes.map((c) => (
            <Puce key={c.id} ton="gris">
              {c.nom}
            </Puce>
          ))}
        </>
      }
      pied={
        <>
          {campagneId ? (
            <BoutonEcarterContact contactId={fiche.contact.id} campagneId={campagneId} libelle={t('fiche.actions.discardFromCampaign')} />
          ) : (
            <span />
          )}
          <BoutonNePlusContacter contactId={fiche.contact.id} libelle={t('fiche.actions.doNotContact')} />
        </>
      }
    >
      <SectionPourquoiLui pourquoi={fiche.pourquoi} score={fiche.score} fuseau={fuseau} />
      <SectionOuEnEstOn sequence={fiche.sequence} campagneId={campagneId ?? null} fuseau={fuseau} />
      <SectionEchanges echanges={fiche.echanges} filId={fiche.filId} contactNom={nom} fuseau={fuseau} />
      <SectionCoordonnees contact={fiche.contact} />
      <SectionNotes notes={fiche.notes} contactId={fiche.contact.id} fuseau={fuseau} />
      <SectionHistorique historique={fiche.historique} fuseau={fuseau} />
    </Tiroir>
  );
}

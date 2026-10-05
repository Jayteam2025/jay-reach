'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TypeSource } from '@jay-reach/core';
import { Bouton, Champ, Tiroir, TuileLogo } from '../ui';
import { actionCreerSource, actionModifierSourceCampagne } from '../../app/actions/sources';
import {
  ChampsSourceLinkedIn,
  construireConfigLinkedIn,
  etatChampsLinkedInDepuisConfig,
  type EtatChampsLinkedIn,
  type PersonaChoix,
  type TypeLinkedIn,
} from './ChampsSourceLinkedIn';

// Ré-exporté : les appelants existants (`page.tsx`) importaient `TypeLinkedIn`
// depuis ce fichier avant que le type ne déménage vers `ChampsSourceLinkedIn`
// (tour de correction 1, R57) — pas de raison de leur faire changer d'import
// pour un déplacement purement interne.
export type { TypeLinkedIn };

export interface SourceLinkedInExistante {
  readonly id: string;
  readonly nom: string;
  readonly config: Record<string, unknown>;
  readonly schedule: string;
}

export interface TiroirSourceLinkedInProps {
  readonly campagneId: string;
  readonly providerId: TypeLinkedIn;
  readonly source: SourceLinkedInExistante | null;
  /** Personas de la campagne ; plusieurs → le persona de la source est à choisir. */
  readonly personas?: readonly PersonaChoix[];
}

const CLE_TITRE: Record<TypeLinkedIn, string> = {
  linkedin_post_engagers: 'menu.linkedinPostEngagers.title',
  linkedin_competitor_followers: 'menu.linkedinCompetitorFollowers.title',
  linkedin_keywords: 'menu.linkedinKeywords.title',
  linkedin_job_change: 'menu.linkedinJobChange.title',
};

/**
 * Tiroir des quatre types LinkedIn (maquette `tiroir-source-linkedin.html`) :
 * réglable dès maintenant, mais la collecte ne démarre qu'au lot 4 — pas de
 * bouton « Lancer un passage » (`collecteDisponible` toujours faux pour ces
 * types, `packages/core/src/fonctions/sources.ts`). Un seul sous-formulaire à
 * la fois (le type vient du menu qui a ouvert ce tiroir), pas d'onglets
 * internes pour prévisualiser les quatre variantes comme la maquette.
 *
 * Champs propres au sous-type + construction de la `config` : partagés avec
 * l'assistant de création de campagne via `ChampsSourceLinkedIn` (tâche 14,
 * R57 — ni tiroir ni tour de correction n'a de raison de diverger sur ce
 * qu'attend `configLinkedIn*`). Ce fichier garde son propre nom de source, sa
 * cadence et son appel serveur (`actionCreerSource`/`actionModifierSourceCampagne`).
 */
export function TiroirSourceLinkedIn({ campagneId, providerId, source, personas = [] }: TiroirSourceLinkedInProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const [nom, setNom] = useState(source?.nom ?? '');
  const [schedule, setSchedule] = useState(source?.schedule ?? 'every 24h');
  const [etat, setEtat] = useState<EtatChampsLinkedIn>(() => etatChampsLinkedInDepuisConfig(source?.config ?? {}));

  function fermer() {
    router.push('?', { scroll: false });
  }

  function modifierEtat(patch: Partial<EtatChampsLinkedIn>) {
    setEtat((precedent) => ({ ...precedent, ...patch }));
  }

  function enregistrer() {
    setErreur(null);
    if (providerId === 'linkedin_post_engagers' && personas.length > 1 && !etat.personaId) {
      setErreur(t('drawer.personaRequis'));
      return;
    }
    const config = construireConfigLinkedIn(providerId, etat);
    startTransition(async () => {
      const res = source
        ? await actionModifierSourceCampagne(campagneId, {
            sourceId: source.id,
            nom,
            config,
            schedule,
          })
        : await actionCreerSource(campagneId, {
            providerId: providerId as TypeSource,
            nom,
            config,
            schedule,
          });
      if (res.ok) {
        fermer();
      } else {
        setErreur(res.issues?.join(' ') ?? res.error);
      }
    });
  }

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={t(CLE_TITRE[providerId])}
      icone={<TuileLogo marque="linkedin" taille="grande" />}
      pied={
        <>
          <span />
          <Bouton variante="principal" onClick={enregistrer} disabled={pending}>
            {source ? t('drawer.save') : t('drawer.create')}
          </Bouton>
        </>
      }
    >
      <div className="jr-formulaire">
        <div className="jr-bandeau attention">{t('drawer.linkedinPending')}</div>
        <Champ libelle={t('drawer.name')}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} />
        </Champ>

        <ChampsSourceLinkedIn
          providerId={providerId}
          etat={etat}
          onChange={modifierEtat}
          personas={personas}
          libelles={{
            postUrl: t('drawer.postUrl'),
            keepPeople: t('drawer.keepPeople'),
            commented: t('drawer.commented'),
            reacted: t('drawer.reacted'),
            postOneCampaign: t('drawer.postOneCampaign'),
            competitorPages: t('drawer.competitorPages'),
            topics: t('drawer.topics'),
            sinceDays: t('drawer.sinceDays'),
            accountId: t('drawer.accountId'),
            profilesPerDay: t('drawer.profilesPerDay'),
            persona: t('drawer.persona'),
            personaChoisir: t('drawer.personaChoisir'),
          }}
        />

        <Champ libelle={t('drawer.schedule')}>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            <option value="every 24h">{t('card.everyNHours', { n: 24 })}</option>
            <option value="every 48h">{t('card.everyNHours', { n: 48 })}</option>
          </select>
        </Champ>
        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </div>
    </Tiroir>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TypeSource } from '@jay-reach/core';
import { Bouton, Champ, Tiroir, TuileLogo } from '../ui';
import { actionCreerSource, actionModifierSourceCampagne } from '../../app/actions/sources';
import { CaseACocher } from './CaseACocher';

export type TypeLinkedIn =
  | 'linkedin_post_engagers'
  | 'linkedin_competitor_followers'
  | 'linkedin_keywords'
  | 'linkedin_job_change';

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
}

function listeVersTexte(v: unknown): string {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '';
}
function texteVersListe(t: string): string[] {
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
 */
export function TiroirSourceLinkedIn({
  campagneId,
  providerId,
  source,
}: TiroirSourceLinkedInProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const config = source?.config ?? {};
  const [nom, setNom] = useState(source?.nom ?? '');
  const [compteId, setCompteId] = useState(
    typeof config.compteId === 'string' ? config.compteId : '',
  );
  const [profilsParJour, setProfilsParJour] = useState(
    typeof config.profilsParJour === 'number' ? String(config.profilsParJour) : '40',
  );
  const [schedule, setSchedule] = useState(source?.schedule ?? 'every 24h');

  // Champs propres à chaque sous-type.
  const [urlPost, setUrlPost] = useState(typeof config.urlPost === 'string' ? config.urlPost : '');
  const [garderCommente, setGarderCommente] = useState(
    Array.isArray(config.garder) ? config.garder.includes('commente') : true,
  );
  const [garderReagi, setGarderReagi] = useState(
    Array.isArray(config.garder) ? config.garder.includes('reagi') : true,
  );
  const [exclurePremierDegre, setExclurePremierDegre] = useState(
    config.exclurePremierDegre !== false,
  );
  const [comptesConcurrents, setComptesConcurrents] = useState(
    listeVersTexte(config.comptesConcurrents),
  );
  const [sujets, setSujets] = useState(listeVersTexte(config.sujets));
  const [depuisJours, setDepuisJours] = useState(
    typeof config.depuisJours === 'number' ? String(config.depuisJours) : '90',
  );

  function fermer() {
    router.push('?', { scroll: false });
  }

  function construireConfig(): Record<string, unknown> {
    const commun = { compteId, profilsParJour: Number(profilsParJour) || 40 };
    switch (providerId) {
      case 'linkedin_post_engagers': {
        const garder: string[] = [];
        if (garderCommente) garder.push('commente');
        if (garderReagi) garder.push('reagi');
        return { ...commun, urlPost, garder, exclurePremierDegre };
      }
      case 'linkedin_competitor_followers':
        return { ...commun, comptesConcurrents: texteVersListe(comptesConcurrents) };
      case 'linkedin_keywords':
        return { ...commun, sujets: texteVersListe(sujets) };
      case 'linkedin_job_change':
        return { ...commun, depuisJours: Number(depuisJours) || 90 };
    }
  }

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const res = source
        ? await actionModifierSourceCampagne(campagneId, {
            sourceId: source.id,
            nom,
            config: construireConfig(),
            schedule,
          })
        : await actionCreerSource(campagneId, {
            providerId: providerId as TypeSource,
            nom,
            config: construireConfig(),
            schedule,
          });
      if (res.ok) {
        router.refresh();
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

        {providerId === 'linkedin_post_engagers' && (
          <>
            <Champ libelle={t('drawer.postUrl')}>
              <input
                value={urlPost}
                onChange={(e) => setUrlPost(e.target.value)}
                placeholder="https://www.linkedin.com/posts/…"
              />
            </Champ>
            <div>
              <span className="jr-libelle">{t('drawer.keepPeople')}</span>
              <CaseACocher coche={garderCommente} onChange={setGarderCommente}>
                {t('drawer.commented')}
              </CaseACocher>
              <CaseACocher coche={garderReagi} onChange={setGarderReagi}>
                {t('drawer.reacted')}
              </CaseACocher>
              <CaseACocher coche={exclurePremierDegre} onChange={setExclurePremierDegre}>
                {t('drawer.excludeFirstDegree')}
              </CaseACocher>
            </div>
          </>
        )}
        {providerId === 'linkedin_competitor_followers' && (
          <Champ libelle={t('drawer.competitorPages')}>
            <input
              value={comptesConcurrents}
              onChange={(e) => setComptesConcurrents(e.target.value)}
              placeholder="Upsell, Uptoo"
            />
          </Champ>
        )}
        {providerId === 'linkedin_keywords' && (
          <Champ libelle={t('drawer.topics')}>
            <input
              value={sujets}
              onChange={(e) => setSujets(e.target.value)}
              placeholder="CRM commercial, pipe de vente"
            />
          </Champ>
        )}
        {providerId === 'linkedin_job_change' && (
          <Champ libelle={t('drawer.sinceDays')}>
            <input
              value={depuisJours}
              onChange={(e) => setDepuisJours(e.target.value)}
              placeholder="90"
            />
          </Champ>
        )}

        <div className="ligne">
          <Champ libelle={t('drawer.accountId')}>
            <input value={compteId} onChange={(e) => setCompteId(e.target.value)} />
          </Champ>
          <Champ libelle={t('drawer.profilesPerDay')}>
            <input
              value={profilsParJour}
              onChange={(e) => setProfilsParJour(e.target.value)}
              placeholder="40"
            />
          </Champ>
        </div>
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

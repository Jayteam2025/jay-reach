'use client';

import { Champ } from '../ui';
import { CaseACocher } from './CaseACocher';

export type TypeLinkedIn =
  | 'linkedin_post_engagers'
  | 'linkedin_competitor_followers'
  | 'linkedin_keywords'
  | 'linkedin_job_change';

/** État des champs communs aux quatre sous-types LinkedIn, PLUS ceux propres à chacun (en pratique, seuls ceux du sous-type affiché sont lus par `construireConfigLinkedIn`). */
export interface EtatChampsLinkedIn {
  readonly compteId: string;
  readonly profilsParJour: string;
  readonly urlPost: string;
  readonly garderCommente: boolean;
  readonly garderReagi: boolean;
  readonly comptesConcurrents: string;
  readonly sujets: string;
  readonly depuisJours: string;
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

/**
 * État par défaut, ou reconstitué depuis une `config` déjà stockée (édition) —
 * extrait de `TiroirSourceLinkedIn` (tâche 11) pour être réutilisé tel quel
 * par l'assistant (tâche 14, R57) : les deux points d'entrée créent la même
 * forme de source, seul le formulaire autour (tiroir vs étape de l'assistant)
 * diffère.
 */
export function etatChampsLinkedInDepuisConfig(config: Record<string, unknown> = {}): EtatChampsLinkedIn {
  return {
    compteId: typeof config.compteId === 'string' ? config.compteId : '',
    profilsParJour: typeof config.profilsParJour === 'number' ? String(config.profilsParJour) : '40',
    urlPost: typeof config.urlPost === 'string' ? config.urlPost : '',
    garderCommente: Array.isArray(config.garder) ? config.garder.includes('commente') : true,
    garderReagi: Array.isArray(config.garder) ? config.garder.includes('reagi') : true,
    comptesConcurrents: listeVersTexte(config.comptesConcurrents),
    sujets: listeVersTexte(config.sujets),
    depuisJours: typeof config.depuisJours === 'number' ? String(config.depuisJours) : '90',
  };
}

/** Construit la `config` envoyée à `creerSource`/`modifierSource` (schémas `configLinkedIn*`, `packages/core/src/fonctions/sources.ts`) : uniquement les clés du sous-type choisi, jamais celles des trois autres. */
export function construireConfigLinkedIn(providerId: TypeLinkedIn, etat: EtatChampsLinkedIn): Record<string, unknown> {
  const commun = { compteId: etat.compteId, profilsParJour: Number(etat.profilsParJour) || 40 };
  switch (providerId) {
    case 'linkedin_post_engagers': {
      const garder: string[] = [];
      if (etat.garderCommente) garder.push('commente');
      if (etat.garderReagi) garder.push('reagi');
      // Ni compte ni cadence : l'exécution est côté serveur, le post suffit.
      return { urlPost: etat.urlPost, garder };
    }
    case 'linkedin_competitor_followers':
      return { ...commun, comptesConcurrents: texteVersListe(etat.comptesConcurrents) };
    case 'linkedin_keywords':
      return { ...commun, sujets: texteVersListe(etat.sujets) };
    case 'linkedin_job_change':
      return { ...commun, depuisJours: Number(etat.depuisJours) || 90 };
  }
}

/** Champ requis du sous-type (en plus du compte LinkedIn, commun aux trois autres) rempli — condition d'activation du bouton d'enregistrement. */
export function champsLinkedInValides(providerId: TypeLinkedIn, etat: EtatChampsLinkedIn): boolean {
  if (providerId !== 'linkedin_post_engagers' && !etat.compteId.trim()) return false;
  switch (providerId) {
    case 'linkedin_post_engagers':
      return etat.urlPost.trim().length > 0 && (etat.garderCommente || etat.garderReagi);
    case 'linkedin_competitor_followers':
      return texteVersListe(etat.comptesConcurrents).length > 0;
    case 'linkedin_keywords':
      return texteVersListe(etat.sujets).length > 0;
    case 'linkedin_job_change':
      return true;
  }
}

export interface ChampsSourceLinkedInLibelles {
  readonly postUrl: string;
  readonly keepPeople: string;
  readonly commented: string;
  readonly reacted: string;
  readonly postOneCampaign: string;
  readonly competitorPages: string;
  readonly topics: string;
  readonly sinceDays: string;
  readonly accountId: string;
  readonly profilesPerDay: string;
}

export interface ChampsSourceLinkedInProps {
  readonly providerId: TypeLinkedIn;
  readonly etat: EtatChampsLinkedIn;
  readonly onChange: (patch: Partial<EtatChampsLinkedIn>) => void;
  readonly disabled?: boolean;
  readonly libelles: ChampsSourceLinkedInLibelles;
  /** Préfixe des `id` de champ (tour de correction 2, R66) — utile si jamais deux instances se retrouvent sur la même page ; les deux appelants actuels (tiroir tâche 11, assistant tâche 14) n'en ont chacun qu'une, le défaut suffit. */
  readonly idPrefix?: string;
}

/**
 * Champs propres aux quatre sous-types LinkedIn (maquette
 * `tiroir-source-linkedin.html`) — partie PURE (valeur/onChange) extraite de
 * `TiroirSourceLinkedIn` pour être réutilisée par l'assistant de création de
 * campagne (R57) sans copie : ni tiroir, ni bouton d'enregistrement, ni appel
 * serveur — l'appelant garde la main sur son propre nom de source, sa cadence
 * et son mode de soumission.
 */
export function ChampsSourceLinkedIn({
  providerId,
  etat,
  onChange,
  disabled,
  libelles,
  idPrefix = 'linkedin',
}: ChampsSourceLinkedInProps) {
  return (
    <>
      {providerId === 'linkedin_post_engagers' && (
        <>
          <Champ libelle={libelles.postUrl} id={`${idPrefix}-post-url`}>
            <input
              id={`${idPrefix}-post-url`}
              name="urlPost"
              value={etat.urlPost}
              onChange={(e) => onChange({ urlPost: e.target.value })}
              disabled={disabled}
              placeholder="https://www.linkedin.com/posts/…"
            />
          </Champ>
          <div>
            <span className="jr-libelle">{libelles.keepPeople}</span>
            <CaseACocher coche={etat.garderCommente} onChange={(v) => onChange({ garderCommente: v })}>
              {libelles.commented}
            </CaseACocher>
            <CaseACocher coche={etat.garderReagi} onChange={(v) => onChange({ garderReagi: v })}>
              {libelles.reacted}
            </CaseACocher>
          </div>
          <p className="jr-aide">{libelles.postOneCampaign}</p>
        </>
      )}
      {providerId === 'linkedin_competitor_followers' && (
        <Champ libelle={libelles.competitorPages} id={`${idPrefix}-competitor-pages`}>
          <input
            id={`${idPrefix}-competitor-pages`}
            name="comptesConcurrents"
            value={etat.comptesConcurrents}
            onChange={(e) => onChange({ comptesConcurrents: e.target.value })}
            disabled={disabled}
            placeholder="Upsell, Uptoo"
          />
        </Champ>
      )}
      {providerId === 'linkedin_keywords' && (
        <Champ libelle={libelles.topics} id={`${idPrefix}-topics`}>
          <input
            id={`${idPrefix}-topics`}
            name="sujets"
            value={etat.sujets}
            onChange={(e) => onChange({ sujets: e.target.value })}
            disabled={disabled}
            placeholder="CRM commercial, pipe de vente"
          />
        </Champ>
      )}
      {providerId === 'linkedin_job_change' && (
        <Champ libelle={libelles.sinceDays} id={`${idPrefix}-since-days`}>
          <input
            id={`${idPrefix}-since-days`}
            name="depuisJours"
            value={etat.depuisJours}
            onChange={(e) => onChange({ depuisJours: e.target.value })}
            disabled={disabled}
            placeholder="90"
          />
        </Champ>
      )}
      {providerId !== 'linkedin_post_engagers' && (
      <div className="ligne">
        <Champ libelle={libelles.accountId} id={`${idPrefix}-account-id`}>
          <input
            id={`${idPrefix}-account-id`}
            name="compteId"
            value={etat.compteId}
            onChange={(e) => onChange({ compteId: e.target.value })}
            disabled={disabled}
          />
        </Champ>
        <Champ libelle={libelles.profilesPerDay} id={`${idPrefix}-profiles-per-day`}>
          <input
            id={`${idPrefix}-profiles-per-day`}
            name="profilsParJour"
            value={etat.profilsParJour}
            onChange={(e) => onChange({ profilsParJour: e.target.value })}
            disabled={disabled}
            placeholder="40"
          />
        </Champ>
      </div>
      )}
    </>
  );
}

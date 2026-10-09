'use client';

import { TYPES_LINKEDIN_COLLECTES } from '@jay-reach/core';
import { Champ } from '../ui';
import { CaseACocher } from './CaseACocher';

export type TypeLinkedIn =
  | 'linkedin_post_engagers'
  | 'linkedin_competitor_posts'
  | 'linkedin_creator_posts'
  | 'linkedin_keywords'
  | 'linkedin_job_change';

/** État des champs communs aux quatre sous-types LinkedIn, PLUS ceux propres à chacun (en pratique, seuls ceux du sous-type affiché sont lus par `construireConfigLinkedIn`). */
export interface EtatChampsLinkedIn {
  readonly compteId: string;
  readonly profilsParJour: string;
  readonly urlPost: string;
  /** Persona de la source d'engageurs : n'a de sens que si la campagne en porte plusieurs. */
  readonly personaId: string;
  readonly garderCommente: boolean;
  readonly garderReagi: boolean;
  readonly pagesConcurrentes: string;
  readonly profilsCreateurs: string;
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
    personaId: typeof config.personaId === 'string' ? config.personaId : '',
    garderCommente: Array.isArray(config.garder) ? config.garder.includes('commente') : true,
    garderReagi: Array.isArray(config.garder) ? config.garder.includes('reagi') : true,
    pagesConcurrentes: listeVersTexte(config.pagesConcurrentes),
    profilsCreateurs: listeVersTexte(config.profilsCreateurs),
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
      return { urlPost: etat.urlPost, garder, ...(etat.personaId ? { personaId: etat.personaId } : {}) };
    }
    case 'linkedin_competitor_posts': {
      // Mêmes besoins que le post : c'est le même collecteur d'engageurs derrière, seule la
      // façon de trouver les posts change. Ni compte ni cadence : l'exécution est côté serveur.
      const garder: string[] = [];
      if (etat.garderCommente) garder.push('commente');
      if (etat.garderReagi) garder.push('reagi');
      return {
        pagesConcurrentes: texteVersListe(etat.pagesConcurrentes),
        garder,
        ...(etat.personaId ? { personaId: etat.personaId } : {}),
      };
    }
    case 'linkedin_creator_posts': {
      // Même collecteur d'engageurs que le concurrent : seule l'entrée change (des profils).
      const garder: string[] = [];
      if (etat.garderCommente) garder.push('commente');
      if (etat.garderReagi) garder.push('reagi');
      return {
        profilsCreateurs: texteVersListe(etat.profilsCreateurs),
        garder,
        ...(etat.personaId ? { personaId: etat.personaId } : {}),
      };
    }
    case 'linkedin_keywords':
      // Même collecteur côté serveur : ni compte ni cadence, des mots-clés et le persona.
      return { sujets: texteVersListe(etat.sujets), ...(etat.personaId ? { personaId: etat.personaId } : {}) };
    case 'linkedin_job_change':
      return { ...commun, depuisJours: Number(etat.depuisJours) || 90 };
  }
}

/** Champ requis du sous-type (en plus du compte LinkedIn, commun aux trois autres) rempli — condition d'activation du bouton d'enregistrement. */
/** `nbPersonas` : personas de la campagne ; au-delà d'un, le persona de la source est obligatoire (règle serveur de `creerSource`). */
export function champsLinkedInValides(providerId: TypeLinkedIn, etat: EtatChampsLinkedIn, nbPersonas = 0): boolean {
  // Le compte n'est demandé que par les types qui n'ont pas encore de collecteur serveur.
  if (!TYPES_LINKEDIN_COLLECTES.includes(providerId) && !etat.compteId.trim()) return false;
  switch (providerId) {
    case 'linkedin_post_engagers':
      return (
        etat.urlPost.trim().length > 0 &&
        (etat.garderCommente || etat.garderReagi) &&
        (nbPersonas <= 1 || etat.personaId.length > 0)
      );
    case 'linkedin_competitor_posts':
      return (
        texteVersListe(etat.pagesConcurrentes).length > 0 &&
        (etat.garderCommente || etat.garderReagi) &&
        (nbPersonas <= 1 || etat.personaId.length > 0)
      );
    case 'linkedin_creator_posts':
      return (
        texteVersListe(etat.profilsCreateurs).length > 0 &&
        (etat.garderCommente || etat.garderReagi) &&
        (nbPersonas <= 1 || etat.personaId.length > 0)
      );
    case 'linkedin_keywords':
      return texteVersListe(etat.sujets).length > 0 && (nbPersonas <= 1 || etat.personaId.length > 0);
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
  readonly competitorPagesHint: string;
  readonly creatorProfiles: string;
  readonly creatorProfilesHint: string;
  readonly topics: string;
  readonly topicsHint: string;
  readonly sinceDays: string;
  readonly accountId: string;
  readonly profilesPerDay: string;
  /** Seulement si `personas` est fourni (campagne à plusieurs personas). */
  readonly persona?: string;
  readonly personaChoisir?: string;
}

export interface PersonaChoix {
  readonly id: string;
  readonly nom: string;
}

export interface ChampsSourceLinkedInProps {
  readonly providerId: TypeLinkedIn;
  readonly etat: EtatChampsLinkedIn;
  readonly onChange: (patch: Partial<EtatChampsLinkedIn>) => void;
  readonly disabled?: boolean;
  readonly libelles: ChampsSourceLinkedInLibelles;
  /** Personas de la campagne : la liste de choix n'apparaît que s'il y en a plusieurs. */
  readonly personas?: readonly PersonaChoix[];
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
  personas = [],
  idPrefix = 'linkedin',
}: ChampsSourceLinkedInProps) {
  // « Qui garder » et le persona valent pour les deux sources d'engageurs : c'est le même
  // collecteur, et le même jugement derrière.
  const quiGarder = (
    <div>
      <span className="jr-libelle">{libelles.keepPeople}</span>
      <CaseACocher coche={etat.garderCommente} onChange={(v) => onChange({ garderCommente: v })}>
        {libelles.commented}
      </CaseACocher>
      <CaseACocher coche={etat.garderReagi} onChange={(v) => onChange({ garderReagi: v })}>
        {libelles.reacted}
      </CaseACocher>
    </div>
  );
  const choixPersona =
    personas.length > 1 ? (
      <Champ libelle={libelles.persona ?? ''} id={`${idPrefix}-persona`}>
        <select
          id={`${idPrefix}-persona`}
          name="personaId"
          value={etat.personaId}
          onChange={(e) => onChange({ personaId: e.target.value })}
          disabled={disabled}
          required
        >
          <option value="">{libelles.personaChoisir ?? ''}</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
            </option>
          ))}
        </select>
      </Champ>
    ) : null;

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
          {quiGarder}
          <p className="jr-aide">{libelles.postOneCampaign}</p>
          {choixPersona}
        </>
      )}
      {providerId === 'linkedin_competitor_posts' && (
        <>
          <Champ libelle={libelles.competitorPages} id={`${idPrefix}-competitor-pages`}>
            <input
              id={`${idPrefix}-competitor-pages`}
              name="pagesConcurrentes"
              value={etat.pagesConcurrentes}
              onChange={(e) => onChange({ pagesConcurrentes: e.target.value })}
              disabled={disabled}
              placeholder="https://www.linkedin.com/company/…"
            />
          </Champ>
          <p className="jr-aide">{libelles.competitorPagesHint}</p>
          {quiGarder}
          {choixPersona}
        </>
      )}
      {providerId === 'linkedin_creator_posts' && (
        <>
          <Champ libelle={libelles.creatorProfiles} id={`${idPrefix}-creator-profiles`}>
            <input
              id={`${idPrefix}-creator-profiles`}
              name="profilsCreateurs"
              value={etat.profilsCreateurs}
              onChange={(e) => onChange({ profilsCreateurs: e.target.value })}
              disabled={disabled}
              placeholder="https://www.linkedin.com/in/…"
            />
          </Champ>
          <p className="jr-aide">{libelles.creatorProfilesHint}</p>
          {quiGarder}
          {choixPersona}
        </>
      )}
      {providerId === 'linkedin_keywords' && (
        <>
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
          <p className="jr-aide">{libelles.topicsHint}</p>
          {choixPersona}
        </>
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
      {!TYPES_LINKEDIN_COLLECTES.includes(providerId) && (
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

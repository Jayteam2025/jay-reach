import { describe, expect, it } from 'vitest';
import { champsLinkedInValides, construireConfigLinkedIn, type EtatChampsLinkedIn } from './ChampsSourceLinkedIn';

/**
 * Lot 4b, etape 2 : la source « posts d'un concurrent » est passee cote serveur.
 *
 * Elle a desormais les memes besoins qu'une source de post — qui garder, et quel persona juge —
 * parce que c'est le meme collecteur d'engageurs derriere. Et elle n'a plus de compte ni de
 * cadence : le serveur tient un seul compte LinkedIn, et les plafonds vivent dans les reglages.
 */
const VIDE: EtatChampsLinkedIn = {
  urlPost: '',
  garderCommente: false,
  garderReagi: false,
  personaId: '',
  pagesConcurrentes: '',
  sujets: '',
  depuisJours: '',
  compteId: '',
  profilsParJour: '',
};

describe('source « posts d’un concurrent »', () => {
  const rempli: EtatChampsLinkedIn = {
    ...VIDE,
    pagesConcurrentes: 'https://www.linkedin.com/company/une-page/',
    garderReagi: true,
  };

  it('envoie les pages, qui garder et le persona — jamais de compte ni de cadence', () => {
    const config = construireConfigLinkedIn('linkedin_competitor_posts', { ...rempli, personaId: 'p1' });
    expect(config).toEqual({
      pagesConcurrentes: ['https://www.linkedin.com/company/une-page/'],
      garder: ['reagi'],
      personaId: 'p1',
    });
  });

  it('n’exige plus le compte LinkedIn, que le serveur tient lui-meme', () => {
    expect(champsLinkedInValides('linkedin_competitor_posts', rempli)).toBe(true);
  });

  // Sans « qui garder », la collecte ne saurait pas quoi lire : le serveur refuserait la source
  // apres coup, et l'operateur ne comprendrait pas pourquoi.
  it('exige au moins un type d’engagement', () => {
    expect(champsLinkedInValides('linkedin_competitor_posts', { ...rempli, garderReagi: false })).toBe(false);
  });

  it('exige une page', () => {
    expect(champsLinkedInValides('linkedin_competitor_posts', { ...rempli, pagesConcurrentes: '  ' })).toBe(false);
  });

  it('exige le persona des que la campagne en porte plusieurs', () => {
    expect(champsLinkedInValides('linkedin_competitor_posts', rempli, 2)).toBe(false);
    expect(champsLinkedInValides('linkedin_competitor_posts', { ...rempli, personaId: 'p1' }, 2)).toBe(true);
  });
});

describe('les types sans collecteur serveur gardent leurs anciens champs', () => {
  it('les mots-cles exigent toujours un compte LinkedIn', () => {
    const etat = { ...VIDE, sujets: 'CRM' };
    expect(champsLinkedInValides('linkedin_keywords', etat)).toBe(false);
    expect(champsLinkedInValides('linkedin_keywords', { ...etat, compteId: 'c1' })).toBe(true);
  });
});

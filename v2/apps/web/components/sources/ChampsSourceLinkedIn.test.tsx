import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { TYPES_LINKEDIN_COLLECTES } from '@jay-reach/core';
import {
  ChampsSourceLinkedIn,
  champsLinkedInValides,
  construireConfigLinkedIn,
  type EtatChampsLinkedIn,
  type TypeLinkedIn,
} from './ChampsSourceLinkedIn';

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

/**
 * Ce que l'operateur VOIT. Les textes viennent de `fr.json`, pas d'une chaine reinventee ici :
 * un test qui invente ses libelles ne dirait rien de l'ecran livre.
 */
describe('le formulaire rendu', () => {
  // Les libelles reels, lus sans cast : si une cle disparait de `fr.json`, c'est le typage qui
  // le dit ici, pas l'ecran en production.
  const d = fr.campagne.sources.drawer;
  const libelles = {
    postUrl: d.postUrl,
    keepPeople: d.keepPeople,
    commented: d.commented,
    reacted: d.reacted,
    postOneCampaign: d.postOneCampaign,
    competitorPages: d.competitorPages,
    competitorPagesHint: d.competitorPagesHint,
    topics: d.topics,
    sinceDays: d.sinceDays,
    accountId: d.accountId,
    profilesPerDay: d.profilesPerDay,
    persona: d.persona,
    personaChoisir: d.personaChoisir,
  };
  const rendre = (providerId: TypeLinkedIn, personas: Array<{ id: string; nom: string }> = []) =>
    renderToStaticMarkup(
      <ChampsSourceLinkedIn
        providerId={providerId}
        etat={VIDE}
        onChange={() => undefined}
        disabled={false}
        libelles={libelles}
        personas={personas}
      />,
    );

  it('demande une ADRESSE de page, pas un nom d entreprise', () => {
    const html = rendre('linkedin_competitor_posts');
    expect(html).toContain('https://www.linkedin.com/company/');
    expect(html).toContain('linkedin.com/company/nom-du-concurrent');
  });

  it('propose les memes choix d engagement que pour un post', () => {
    const html = rendre('linkedin_competitor_posts');
    expect(html).toContain(libelles.keepPeople);
    expect(html).toContain(libelles.commented);
    expect(html).toContain(libelles.reacted);
  });

  // Les deux champs morts : plus aucun ecran ne les montre pour cette source.
  it('ne montre plus ni compte LinkedIn ni cadence', () => {
    const html = rendre('linkedin_competitor_posts');
    expect(html).not.toContain('name="compteId"');
    expect(html).not.toContain('name="profilsParJour"');
  });

  it('demande le persona des que la campagne en porte plusieurs', () => {
    expect(rendre('linkedin_competitor_posts')).not.toContain('name="personaId"');
    const html = rendre('linkedin_competitor_posts', [
      { id: 'p1', nom: 'Directeur commercial' },
      { id: 'p2', nom: 'DRH' },
    ]);
    expect(html).toContain('name="personaId"');
    expect(html).toContain('Directeur commercial');
  });

  it('les types sans collecteur serveur gardent leur compte et leur cadence', () => {
    const html = rendre('linkedin_keywords');
    expect(html).toContain('name="compteId"');
    expect(html).toContain('name="profilsParJour"');
  });
});

/**
 * Le bouton « Collecter maintenant » et le bandeau « collecte a venir » se decident sur UNE
 * question : le serveur collecte-t-il ce type ? Elle etait codee sur `linkedin_post_engagers`
 * seul, ce qui privait la source « posts d'un concurrent » de tout moyen de lancer un passage,
 * et lui affichait « la lecture demarrera des que le canal sera actif » alors qu'il l'est.
 */
describe('les types collectes par le serveur', () => {
  it('sont les deux sources d’engageurs, et elles seules', () => {
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_post_engagers')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_competitor_posts')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_keywords')).toBe(false);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_job_change')).toBe(false);
  });

  // Le lien qui compte : l'ecran de saisie et l'ecran de collecte doivent repondre la MEME chose.
  // Tant qu'ils avaient chacun leur liste, une source se saisissait sans compte LinkedIn mais
  // n'avait aucun bouton pour partir.
  it('decident aussi des champs du formulaire : une seule liste pour les deux ecrans', () => {
    for (const type of ['linkedin_post_engagers', 'linkedin_competitor_posts', 'linkedin_keywords', 'linkedin_job_change'] as const) {
      const demandeLeCompte = !champsLinkedInValides(type, { ...VIDE, urlPost: 'x', pagesConcurrentes: 'x', sujets: 'x', garderReagi: true });
      expect(demandeLeCompte).toBe(!TYPES_LINKEDIN_COLLECTES.includes(type));
    }
  });
});

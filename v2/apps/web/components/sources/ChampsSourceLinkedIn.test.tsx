import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { TYPES_LINKEDIN_COLLECTES } from '@jay-reach/core';
import {
  ChampsSourceLinkedIn,
  champsLinkedInValides,
  construireConfigLinkedIn,
  etatChampsLinkedInDepuisConfig,
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
  profilsCreateurs: '',
  sujets: '',
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

describe('source « posts d’un créateur »', () => {
  const rempli: EtatChampsLinkedIn = {
    ...VIDE,
    profilsCreateurs: 'https://www.linkedin.com/in/une-personne/',
    garderReagi: true,
  };

  it('envoie les profils, qui garder et le persona — jamais de compte ni de cadence', () => {
    const config = construireConfigLinkedIn('linkedin_creator_posts', { ...rempli, personaId: 'p1' });
    expect(config).toEqual({
      profilsCreateurs: ['https://www.linkedin.com/in/une-personne/'],
      garder: ['reagi'],
      personaId: 'p1',
    });
  });

  it('n’exige pas le compte LinkedIn, que le serveur tient lui-même', () => {
    expect(champsLinkedInValides('linkedin_creator_posts', rempli)).toBe(true);
  });

  it('exige au moins un type d’engagement', () => {
    expect(champsLinkedInValides('linkedin_creator_posts', { ...rempli, garderReagi: false })).toBe(false);
  });

  it('exige un profil, et les pages concurrentes ne le remplacent pas', () => {
    expect(champsLinkedInValides('linkedin_creator_posts', { ...rempli, profilsCreateurs: '  ' })).toBe(false);
    expect(
      champsLinkedInValides('linkedin_creator_posts', { ...rempli, profilsCreateurs: '', pagesConcurrentes: 'x' }),
    ).toBe(false);
  });

  it('exige le persona dès que la campagne en porte plusieurs', () => {
    expect(champsLinkedInValides('linkedin_creator_posts', rempli, 2)).toBe(false);
    expect(champsLinkedInValides('linkedin_creator_posts', { ...rempli, personaId: 'p1' }, 2)).toBe(true);
  });

  it('se reconstitue depuis une config stockée (édition)', () => {
    const etat = etatChampsLinkedInDepuisConfig({
      profilsCreateurs: ['https://www.linkedin.com/in/une-personne/', 'https://www.linkedin.com/in/une-autre/'],
    });
    expect(etat.profilsCreateurs).toBe('https://www.linkedin.com/in/une-personne/, https://www.linkedin.com/in/une-autre/');
  });
});

describe('source « recherche par mot-clé »', () => {
  const rempli: EtatChampsLinkedIn = { ...VIDE, sujets: 'CRM commercial, pipe de vente' };

  it('envoie les mots-clés et le persona — jamais de compte ni de cadence', () => {
    expect(construireConfigLinkedIn('linkedin_keywords', { ...rempli, personaId: 'p1' })).toEqual({
      sujets: ['CRM commercial', 'pipe de vente'],
      personaId: 'p1',
    });
    expect(construireConfigLinkedIn('linkedin_keywords', rempli)).toEqual({ sujets: ['CRM commercial', 'pipe de vente'] });
  });

  it('n’exige plus le compte LinkedIn, que le serveur tient lui-même', () => {
    expect(champsLinkedInValides('linkedin_keywords', rempli)).toBe(true);
  });

  it('exige un mot-clé', () => {
    expect(champsLinkedInValides('linkedin_keywords', { ...rempli, sujets: ' , ' })).toBe(false);
  });

  it('exige le persona dès que la campagne en porte plusieurs', () => {
    expect(champsLinkedInValides('linkedin_keywords', rempli, 2)).toBe(false);
    expect(champsLinkedInValides('linkedin_keywords', { ...rempli, personaId: 'p1' }, 2)).toBe(true);
  });

  it('se reconstitue depuis une config stockée (édition)', () => {
    const etat = etatChampsLinkedInDepuisConfig({ sujets: ['CRM commercial', 'pipe de vente'], personaId: 'p1' });
    expect(etat.sujets).toBe('CRM commercial, pipe de vente');
    expect(etat.personaId).toBe('p1');
  });
});

describe('source « changement de poste »', () => {
  it('n’envoie aucun réglage : ni compte, ni cadence, ni ancienneté', () => {
    expect(construireConfigLinkedIn('linkedin_job_change', VIDE)).toEqual({});
    expect(construireConfigLinkedIn('linkedin_job_change', { ...VIDE, personaId: 'p1' })).toEqual({ personaId: 'p1' });
  });

  it('n’exige rien d’autre que le persona, dès que la campagne en porte plusieurs', () => {
    expect(champsLinkedInValides('linkedin_job_change', VIDE)).toBe(true);
    expect(champsLinkedInValides('linkedin_job_change', VIDE, 2)).toBe(false);
    expect(champsLinkedInValides('linkedin_job_change', { ...VIDE, personaId: 'p1' }, 2)).toBe(true);
  });

  it('se reconstitue depuis une config stockée (édition), les vestiges de l’extension ignorés', () => {
    const etat = etatChampsLinkedInDepuisConfig({ personaId: 'p1', compteId: 'ancien', profilsParJour: 40, depuisJours: 90 });
    expect(etat).toEqual({ ...VIDE, garderCommente: true, garderReagi: true, personaId: 'p1' });
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
    creatorProfiles: d.creatorProfiles,
    creatorProfilesHint: d.creatorProfilesHint,
    topics: d.topics,
    topicsHint: d.topicsHint,
    jobChangeHint: d.jobChangeHint,
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

  it('demande une adresse de PROFIL pour un créateur, avec son champ à lui', () => {
    const html = rendre('linkedin_creator_posts');
    expect(html).toContain('name="profilsCreateurs"');
    expect(html).toContain('https://www.linkedin.com/in/');
    expect(html).toContain('linkedin.com/in/nom-du-createur');
    expect(html).not.toContain('name="pagesConcurrentes"');
    expect(html).not.toContain('name="compteId"');
    expect(html).toContain(libelles.keepPeople);
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

  // Le libellé doit dire la vérité : cette source ne trouve personne, elle surveille des contacts
  // déjà connus. Le texte vient de fr.json, comme l'écran.
  it('le changement de poste dit qu’il surveille des contacts déjà connus, sans compte, cadence ni champ de saisie', () => {
    const html = rendre('linkedin_job_change');
    expect(html).toContain(libelles.jobChangeHint);
    expect(libelles.jobChangeHint).toContain('ne trouve personne de nouveau');
    expect(libelles.jobChangeHint).toContain('contacts que vous avez déjà');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('name="compteId"');
    expect(html).not.toContain('name="profilsParJour"');
    expect(html).not.toContain('name="depuisJours"');
    expect(html).not.toContain(libelles.keepPeople);
  });

  it('le changement de poste demande le persona dès que la campagne en porte plusieurs', () => {
    expect(rendre('linkedin_job_change')).not.toContain('name="personaId"');
    expect(rendre('linkedin_job_change', [{ id: 'p1', nom: 'Directeur commercial' }, { id: 'p2', nom: 'DRH' }])).toContain('name="personaId"');
  });

  it('la recherche par mot-clé demande ses mots-clés, avec leur aide, sans compte ni cadence', () => {
    const html = rendre('linkedin_keywords');
    expect(html).toContain('name="sujets"');
    expect(html).toContain(libelles.topicsHint);
    expect(html).not.toContain('name="compteId"');
    expect(html).not.toContain('name="profilsParJour"');
    // Aucune lecture de post : ni « qui garder », qui n'a de sens que pour les engageurs.
    expect(html).not.toContain(libelles.keepPeople);
  });

  it('la recherche par mot-clé demande le persona dès que la campagne en porte plusieurs', () => {
    expect(rendre('linkedin_keywords')).not.toContain('name="personaId"');
    expect(rendre('linkedin_keywords', [{ id: 'p1', nom: 'Directeur commercial' }, { id: 'p2', nom: 'DRH' }])).toContain('name="personaId"');
  });
});

/**
 * Le bouton « Collecter maintenant » et le bandeau « collecte a venir » se decident sur UNE
 * question : le serveur collecte-t-il ce type ? Elle etait codee sur `linkedin_post_engagers`
 * seul, ce qui privait la source « posts d'un concurrent » de tout moyen de lancer un passage,
 * et lui affichait « la lecture demarrera des que le canal sera actif » alors qu'il l'est.
 */
describe('les types collectes par le serveur', () => {
  it('sont les cinq types LinkedIn : les trois sources d’engageurs, la recherche par mot-clé et le changement de poste', () => {
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_post_engagers')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_competitor_posts')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_creator_posts')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_keywords')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES.includes('linkedin_job_change')).toBe(true);
    expect(TYPES_LINKEDIN_COLLECTES).toHaveLength(5);
  });

  // Le lien qui compte : l'ecran de saisie et l'ecran de collecte doivent repondre la MEME chose.
  // Les cinq types etant collectes par le serveur, aucun ne demande plus de compte LinkedIn :
  // chacun est valide des que ses champs propres sont remplis.
  it('aucun type ne demande plus de compte : valide des que ses champs propres sont remplis', () => {
    for (const type of ['linkedin_post_engagers', 'linkedin_competitor_posts', 'linkedin_creator_posts', 'linkedin_keywords', 'linkedin_job_change'] as const) {
      expect(TYPES_LINKEDIN_COLLECTES.includes(type)).toBe(true);
      expect(champsLinkedInValides(type, { ...VIDE, urlPost: 'x', pagesConcurrentes: 'x', profilsCreateurs: 'x', sujets: 'x', garderReagi: true })).toBe(true);
    }
  });
});

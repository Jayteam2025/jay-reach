import { describe, expect, it } from 'vitest';
import {
  auteurAvecRepli,
  type AuteurDePost,
  dateDeLActivite,
  lireFichePost,
  lireFichePostDepuisPageOuverte,
  nomAffichePourAuteur,
  SELECTEURS,
  TEXTE_MAX,
} from './fiche-post.js';
import type { Pilote } from './navigateur.js';

/**
 * Pilote factice : une page = des textes par selecteur. Les selecteurs sont des SUPPOSITIONS
 * (aucun releve sur page vivante) ; les fixtures sont inventees, le depot interdit les vraies
 * personnes et entreprises.
 */
const DATE = new Date('2026-10-12T08:30:00.000Z');
const ID_ACTIVITE = (BigInt(DATE.getTime()) << 22n).toString();
const URL_POST = `https://www.linkedin.com/feed/update/urn:li:activity:${ID_ACTIVITE}/`;

function fabrique(textes: Record<string, string>, opts: { url?: string; lever?: boolean } = {}) {
  const requetes: string[] = [];
  const navigations: string[] = [];
  let courante = opts.url ?? URL_POST;
  const p = {
    aller: async (u: string) => {
      navigations.push(u);
      if (opts.lever) throw new Error('navigation impossible');
      courante = u;
    },
    url: async () => courante,
    texte: async (s: string) => {
      if (opts.lever) throw new Error('page fermee');
      return textes[s] ?? '';
    },
    attendre: async (s: string) => s in textes,
    requete: async (u: string) => {
      requetes.push(u);
      return { statut: 200, corps: '' };
    },
  } as unknown as Pilote;
  return { p, requetes, navigations };
}

const PAGE_PERSONNE = {
  [SELECTEURS.auteur[0]]: 'Christelle Dupont\nChristelle Dupont',
  [SELECTEURS.sousTitreAuteur[0]]: 'Directrice commerciale',
  [SELECTEURS.texte[0]]: 'Comment nous avons fait adopter le CRM par toute l equipe.',
};
const PAGE_PAGE = {
  [SELECTEURS.auteur[1]]: 'Societe Exemple',
  [SELECTEURS.sousTitreAuteur[0]]: '12 345 abonnés',
  [SELECTEURS.texte[1]]: 'Notre nouvelle offre est disponible.',
};

describe('nomAffichePourAuteur', () => {
  it('rend le prenom d une personne', () => {
    expect(nomAffichePourAuteur('person', 'Christelle Dupont')).toBe('Christelle');
  });
  it('garde le nom entier d une page', () => {
    expect(nomAffichePourAuteur('page', 'Societe Exemple')).toBe('Societe Exemple');
  });
  it('rend un prenom seul tel quel', () => {
    expect(nomAffichePourAuteur('person', 'Christelle')).toBe('Christelle');
  });
  it('ignore les espaces autour et entre les mots', () => {
    expect(nomAffichePourAuteur('person', '  Jean   Pierre Durand ')).toBe('Jean');
  });
});

describe('dateDeLActivite', () => {
  it('relit la date dans l identifiant d activite', () => {
    expect(dateDeLActivite(`urn:li:activity:${ID_ACTIVITE}`)?.toISOString()).toBe(DATE.toISOString());
  });
  it('refuse un identifiant qui ne donne pas une date plausible', () => {
    expect(dateDeLActivite('urn:li:activity:12345')).toBeNull();
    expect(dateDeLActivite('urn:li:share:abc')).toBeNull();
  });
});

describe('lireFichePostDepuisPageOuverte', () => {
  it('lit une personne sans aucune requete ni navigation', async () => {
    const { p, requetes, navigations } = fabrique(PAGE_PERSONNE);
    const fiche = await lireFichePostDepuisPageOuverte(p);
    expect(requetes).toEqual([]);
    expect(navigations).toEqual([]);
    expect(fiche.urn).toBe(`urn:li:activity:${ID_ACTIVITE}`);
    expect(fiche.auteur).toEqual({
      kind: 'person',
      nom: 'Christelle Dupont',
      nomAffiche: 'Christelle',
      nomPublic: null,
      url: null,
    });
    expect(fiche.texte).toContain('adopter le CRM');
    expect(fiche.date?.toISOString()).toBe(DATE.toISOString());
  });

  it('reconnait une page a sa ligne d abonnes', async () => {
    const { p } = fabrique(PAGE_PAGE);
    const fiche = await lireFichePostDepuisPageOuverte(p);
    expect(fiche.auteur).toMatchObject({ kind: 'page', nom: 'Societe Exemple', nomAffiche: 'Societe Exemple' });
  });

  it('retire le nom double', async () => {
    const { p } = fabrique({ [SELECTEURS.auteur[0]]: 'Marc Martin Marc Martin' });
    expect((await lireFichePostDepuisPageOuverte(p)).auteur?.nom).toBe('Marc Martin');
  });

  it('borne le texte', async () => {
    const { p } = fabrique({ [SELECTEURS.texte[0]]: 'mot '.repeat(1000) });
    expect((await lireFichePostDepuisPageOuverte(p)).texte?.length).toBeLessThanOrEqual(TEXTE_MAX);
  });

  it('rend des champs nuls sur une page vide, sans lever', async () => {
    const { p } = fabrique({}, { url: 'https://www.linkedin.com/feed/' });
    expect(await lireFichePostDepuisPageOuverte(p)).toEqual({
      urn: null,
      url: 'https://www.linkedin.com/feed/',
      auteur: null,
      texte: null,
      date: null,
    });
  });

  it('ne lit rien sur une page de friction', async () => {
    const { p } = fabrique(PAGE_PERSONNE, { url: 'https://www.linkedin.com/checkpoint/challenge/x' });
    const fiche = await lireFichePostDepuisPageOuverte(p);
    expect(fiche.auteur).toBeNull();
    expect(fiche.texte).toBeNull();
  });

  it('ne leve pas quand le navigateur echoue', async () => {
    const { p } = fabrique({}, { lever: true });
    const fiche = await lireFichePostDepuisPageOuverte(p);
    expect(fiche.auteur).toBeNull();
    expect(fiche.texte).toBeNull();
  });
});

describe('lireFichePost', () => {
  it('navigue une fois, ne requete jamais, et garde l url demandee', async () => {
    const { p, requetes, navigations } = fabrique(PAGE_PERSONNE, { url: 'about:blank' });
    const fiche = await lireFichePost(p, URL_POST);
    expect(navigations).toEqual([URL_POST]);
    expect(requetes).toEqual([]);
    expect(fiche.url).toBe(URL_POST);
    expect(fiche.auteur?.kind).toBe('person');
  });

  it('ne leve pas quand la navigation echoue', async () => {
    const { p } = fabrique({}, { lever: true });
    const fiche = await lireFichePost(p, URL_POST);
    expect(fiche.auteur).toBeNull();
    expect(fiche.urn).toBe(`urn:li:activity:${ID_ACTIVITE}`);
    expect(fiche.date?.toISOString()).toBe(DATE.toISOString());
  });
});

describe('auteurAvecRepli', () => {
  // Fixtures dérivées de la fonction réelle : jamais de `nomAffiche` écrit à la main.
  const auteur = (kind: 'person' | 'page', nom: string, reste: Partial<AuteurDePost> = {}): AuteurDePost => ({
    kind,
    nom,
    nomAffiche: nomAffichePourAuteur(kind, nom),
    nomPublic: null,
    url: null,
    ...reste,
  });
  const connu: AuteurDePost = { kind: 'page', nom: 'acme', nomAffiche: '', nomPublic: 'acme', url: 'https://www.linkedin.com/company/acme/' };

  it('sans auteur connu, garde ce que la page a rendu', () => {
    const lu = auteur('person', 'Ada Lovelace');
    expect(auteurAvecRepli(lu, null)).toBe(lu);
    expect(auteurAvecRepli(null, null)).toBeNull();
  });
  it('sans auteur lu, prend l’auteur connu, au nom affiché vide', () => {
    expect(auteurAvecRepli(null, connu)).toBe(connu);
    expect(connu.nomAffiche).toBe('');
  });
  it('même type : garde le nom affiché lu, complète le nom public et l’adresse', () => {
    const lu = auteur('page', 'Acme France');
    expect(auteurAvecRepli(lu, connu)).toEqual({ ...lu, nomPublic: 'acme', url: connu.url });
  });
  it('la page croit « personne », la source sait « page » : nom entier, pas le prénom', () => {
    const lu = auteur('person', 'Acme France');
    expect(lu.nomAffiche).toBe('Acme');
    expect(auteurAvecRepli(lu, connu)?.nomAffiche).toBe('Acme France');
    expect(auteurAvecRepli(lu, connu)?.kind).toBe('page');
  });
  it('la page croit « page », la source sait « personne » : prénom seul', () => {
    const lu = auteur('page', 'Ada Lovelace');
    expect(lu.nomAffiche).toBe('Ada Lovelace');
    const personne = auteur('person', 'ada-lovelace', { nomAffiche: '', nomPublic: 'ada-lovelace' });
    expect(auteurAvecRepli(lu, personne)?.nomAffiche).toBe('Ada');
  });
});

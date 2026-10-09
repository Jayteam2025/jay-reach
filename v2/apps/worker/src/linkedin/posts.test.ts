import { describe, expect, it } from 'vitest';
import {
  QUERY_ID_POSTS_DE_PAGE,
  TENTATIVES_RESOLUTION,
  extrairePostsDePage,
  idSocieteDepuisHtml,
  listerPostsDePage,
  modeleAbsentDuHtml,
  nomPublicDePage,
  resoudrePageEntreprise,
  trouverPostsDePage,
  urlPostsDePage,
  urnPageDepuisId,
} from './posts.js';
import type { Pilote } from './navigateur.js';

/**
 * Les fixtures reproduisent la FORME relevee en reel le 09/10/2026
 * (`_internal/2026-10-09-releve-voyager-posts.md`), avec des identifiants inventes : le depot
 * interdit les fixtures portant de vraies personnes ou de vraies entreprises, et une forme
 * inventee ne prouverait rien.
 */
function reponsePosts(urns: readonly string[], total = urns.length, debut = 0) {
  return {
    data: {
      data: {
        feedDashOrganizationalPageUpdatesByOrganizationalPageRelevanceFeed: {
          metadata: { paginationToken: 'jeton', $type: 'com.linkedin.voyager.dash.common.InfiniteScrollMetadata' },
          paging: { count: 10, start: debut, total, $type: 'com.linkedin.restli.common.CollectionMetadata' },
          '*elements': urns.map((u) => `urn:li:fsd_update:(${u},COMPANY_FEED_RELEVANCE,DEBUG_REASON)`),
          $type: 'com.linkedin.restli.common.CollectionResponse',
        },
      },
    },
    included: [],
  };
}

/** Le modele JSON tel que LinkedIn l'embarque dans son HTML : guillemets echappes. */
function htmlDePage(nom: string, idSociete: string, voisins: ReadonlyArray<[string, string]> = []) {
  const entite = (n: string, id: string) =>
    `{&quot;entityUrn&quot;:&quot;urn:li:fsd_company:${id}&quot;,&quot;universalName&quot;:&quot;${n}&quot;,&quot;name&quot;:&quot;Societe ${id}&quot;}`;
  // Les pages « similaires » de la barre laterale arrivent AVANT dans le document : c'est le
  // piege que `idSocieteDepuisHtml` doit eviter en prenant la plus proche, pas la premiere.
  const avant = voisins.map(([n, id]) => entite(n, id)).join(',');
  return `<!doctype html><body><code>{&quot;included&quot;:[${avant}${avant ? ',' : ''}${entite(nom, idSociete)}]}</code></body>`;
}

/**
 * La coquille vide mesuree le 09/10 : LinkedIn sert l'ossature de l'application, sans son modele
 * de donnees. Ni `universalName`, ni `fsd_company`, ni balise canonique.
 */
const COQUILLE = '<!DOCTYPE html><html><head><script>!function(i,n){}(document,window);</script></head><body><div id="app"></div></body></html>';

/** Une pause factice : les tests ne doivent pas attendre les cinq secondes reelles. */
const sansAttendre = async () => undefined;

function piloteFactice(reponses: Array<{ statut: number; corps: string }>): { p: Pilote; urls: string[] } {
  const urls: string[] = [];
  const p = {
    aller: async () => undefined,
    url: async () => 'https://www.linkedin.com/',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (url: string) => {
      urls.push(url);
      return reponses.shift() ?? { statut: 500, corps: '' };
    },
    fermer: async () => undefined,
  } as unknown as Pilote;
  return { p, urls };
}

describe('idSocieteDepuisHtml', () => {
  it('prend la societe du nom public demande, pas la premiere du document', () => {
    const html = htmlDePage('ma-cible', '777', [
      ['page-similaire-un', '111'],
      ['page-similaire-deux', '222'],
    ]);
    expect(idSocieteDepuisHtml(html, 'ma-cible')).toBe('777');
  });

  it('la casse du nom public ne compte pas', () => {
    expect(idSocieteDepuisHtml(htmlDePage('ma-cible', '777'), 'MA-CIBLE')).toBe('777');
  });

  it('rend null quand le nom public n est pas dans la page', () => {
    expect(idSocieteDepuisHtml(htmlDePage('ma-cible', '777'), 'une-autre')).toBeNull();
    expect(idSocieteDepuisHtml('', 'ma-cible')).toBeNull();
  });
});

describe('nomPublicDePage et urnPageDepuisId', () => {
  it('lit le nom public des formes d adresse courantes', () => {
    expect(nomPublicDePage('https://www.linkedin.com/company/ma-cible/')).toBe('ma-cible');
    expect(nomPublicDePage('https://www.linkedin.com/company/ma-cible/posts/?foo=1')).toBe('ma-cible');
    expect(nomPublicDePage('linkedin.com/showcase/ma-vitrine')).toBe('ma-vitrine');
    expect(nomPublicDePage('https://www.linkedin.com/in/une-personne/')).toBeNull();
  });

  it('l identifiant de page est celui de la societe (mesure sur trois exemples reels)', () => {
    expect(urnPageDepuisId('1035')).toBe('urn:li:fsd_organizationalPage:1035');
  });
});

describe('urlPostsDePage', () => {
  it('porte le queryId releve, la pagination par start/count et l URN de page', () => {
    const url = urlPostsDePage('urn:li:fsd_organizationalPage:777', 30, 10);
    expect(url).toContain(`queryId=${QUERY_ID_POSTS_DE_PAGE}`);
    expect(url).toContain('count:10,start:30');
    expect(url).toContain('moduleKey:ORGANIZATION_MEMBER_FEED_DESKTOP');
    expect(url).toContain(encodeURIComponent('urn:li:fsd_organizationalPage:777'));
  });
});

describe('extrairePostsDePage', () => {
  it('sort les URN d activite de *elements, et le total annonce', () => {
    const page = extrairePostsDePage(reponsePosts(['urn:li:activity:111', 'urn:li:activity:222'], 501, 3));
    expect(page).toEqual({ urns: ['urn:li:activity:111', 'urn:li:activity:222'], total: 501 });
  });

  it('ne compte jamais deux fois le meme post', () => {
    const page = extrairePostsDePage(reponsePosts(['urn:li:activity:111', 'urn:li:activity:111']));
    expect(page?.urns).toEqual(['urn:li:activity:111']);
  });

  // La decision de conception du module : une forme inattendue ne doit JAMAIS se lire
  // « zero post ». Sinon un queryId perime rend une collecte muette, indistinguable d une
  // page qui ne publie pas, pendant des semaines.
  it('rend null — et pas une liste vide — quand la forme n est pas celle attendue', () => {
    expect(extrairePostsDePage(null)).toBeNull();
    expect(extrairePostsDePage({})).toBeNull();
    expect(extrairePostsDePage({ data: { data: {} } })).toBeNull();
    expect(extrairePostsDePage({ data: { data: { flux: { paging: { total: 3 } } } } })).toBeNull();
    expect(extrairePostsDePage({ data: { data: { flux: { '*elements': 'pas un tableau' } } } })).toBeNull();
  });

  it('une page reellement vide garde sa forme : liste vide ET total', () => {
    expect(extrairePostsDePage(reponsePosts([], 0))).toEqual({ urns: [], total: 0 });
  });
});

describe('listerPostsDePage', () => {
  it('rend les posts de la page demandee', async () => {
    const { p, urls } = piloteFactice([
      { statut: 200, corps: JSON.stringify(reponsePosts(['urn:li:activity:111'], 42)) },
    ]);
    await expect(listerPostsDePage(p, 'urn:li:fsd_organizationalPage:777', 0)).resolves.toEqual({
      urns: ['urn:li:activity:111'],
      total: 42,
    });
    expect(urls[0]).toContain('start:0');
  });

  it('un queryId perime leve une erreur nommee, jamais une liste vide', async () => {
    const { p } = piloteFactice([{ statut: 200, corps: JSON.stringify({ data: { data: {} } }) }]);
    await expect(listerPostsDePage(p, 'urn:li:fsd_organizationalPage:777', 0)).rejects.toMatchObject({
      name: 'PostsIllisibles',
    });
  });

  it('un corps qui n est pas du JSON leve aussi', async () => {
    const { p } = piloteFactice([{ statut: 200, corps: '<html>deconnecte</html>' }]);
    await expect(listerPostsDePage(p, 'urn:li:fsd_organizationalPage:777', 0)).rejects.toMatchObject({
      name: 'PostsIllisibles',
    });
  });

  it('un 429 engage le compte, un 400 non', async () => {
    const { p: p429 } = piloteFactice([{ statut: 429, corps: '' }]);
    await expect(listerPostsDePage(p429, 'urn:li:fsd_organizationalPage:777', 0)).rejects.toMatchObject({
      name: 'PostsIndisponibles',
      engageLeCompte: true,
    });
    const { p: p400 } = piloteFactice([{ statut: 400, corps: '' }]);
    await expect(listerPostsDePage(p400, 'urn:li:fsd_organizationalPage:777', 0)).rejects.toMatchObject({
      name: 'PostsIndisponibles',
      engageLeCompte: false,
    });
  });
});

describe('modeleAbsentDuHtml', () => {
  it('reconnait la coquille d application servie sans modele', () => {
    expect(modeleAbsentDuHtml(COQUILLE)).toBe(true);
  });

  it('une page servie avec son modele n est pas une coquille', () => {
    expect(modeleAbsentDuHtml(htmlDePage('ma-cible', '777'))).toBe(false);
  });
});

describe('resoudrePageEntreprise', () => {
  it('lit l identifiant dans le HTML et rend l URN de page', async () => {
    const { p, urls } = piloteFactice([{ statut: 200, corps: htmlDePage('ma-cible', '777', [['voisine', '111']]) }]);
    await expect(resoudrePageEntreprise(p, 'https://www.linkedin.com/company/ma-cible/posts/')).resolves.toBe(
      'urn:li:fsd_organizationalPage:777',
    );
    expect(urls[0]).toBe('https://www.linkedin.com/company/ma-cible/');
  });

  it('une adresse qui n est pas une page entreprise est refusee sans requete', async () => {
    const { p, urls } = piloteFactice([]);
    await expect(resoudrePageEntreprise(p, 'https://www.linkedin.com/in/une-personne/')).rejects.toMatchObject({
      name: 'PageIllisible',
    });
    expect(urls).toHaveLength(0);
  });

  // Le comportement qui a motive la correction : une coquille n est PAS une page introuvable.
  it('redemande la page quand LinkedIn sert sa coquille vide', async () => {
    const { p, urls } = piloteFactice([
      { statut: 200, corps: COQUILLE },
      { statut: 200, corps: htmlDePage('ma-cible', '777') },
    ]);
    await expect(
      resoudrePageEntreprise(p, 'https://www.linkedin.com/company/ma-cible/', undefined, sansAttendre),
    ).resolves.toBe('urn:li:fsd_organizationalPage:777');
    expect(urls).toHaveLength(2);
  });

  it('abandonne sous un nom propre quand la coquille revient a chaque essai', async () => {
    const { p, urls } = piloteFactice(
      Array.from({ length: TENTATIVES_RESOLUTION }, () => ({ statut: 200, corps: COQUILLE })),
    );
    await expect(
      resoudrePageEntreprise(p, 'https://www.linkedin.com/company/ma-cible/', undefined, sansAttendre),
    ).rejects.toMatchObject({ name: 'PageSansModele', engageLeCompte: false });
    expect(urls).toHaveLength(TENTATIVES_RESOLUTION);
  });

  // L inverse : le modele est la, il ne porte simplement pas ce nom. Redemander n y changerait
  // rien, et c est l operateur qui doit corriger son adresse.
  it('une page dont le modele ne porte pas ce nom echoue du premier coup', async () => {
    const { p, urls } = piloteFactice([
      { statut: 200, corps: htmlDePage('une-autre', '111') },
      { statut: 200, corps: htmlDePage('ma-cible', '777') },
    ]);
    await expect(
      resoudrePageEntreprise(p, 'https://www.linkedin.com/company/ma-cible/', undefined, sansAttendre),
    ).rejects.toMatchObject({ name: 'PageIllisible' });
    expect(urls).toHaveLength(1);
  });

  it('un 999 de LinkedIn engage le compte', async () => {
    const { p } = piloteFactice([{ statut: 999, corps: '' }]);
    await expect(resoudrePageEntreprise(p, 'https://www.linkedin.com/company/ma-cible/')).rejects.toMatchObject({
      name: 'PageIntrouvable',
      engageLeCompte: true,
    });
  });

  it('chaque requete est comptee avant de partir', async () => {
    const { p } = piloteFactice([
      { statut: 200, corps: COQUILLE },
      { statut: 200, corps: htmlDePage('ma-cible', '777') },
    ]);
    let comptees = 0;
    await resoudrePageEntreprise(
      p,
      'https://www.linkedin.com/company/ma-cible/',
      async () => {
        comptees += 1;
      },
      sansAttendre,
    );
    expect(comptees).toBe(2);
  });
});

describe('trouverPostsDePage', () => {
  const page = (n: number) => `urn:li:activity:${n}`;
  const lot = (n: number[], total: number, debut: number) => ({
    statut: 200,
    corps: JSON.stringify(reponsePosts(n.map(page), total, debut)),
  });
  const html = { statut: 200, corps: htmlDePage('ma-cible', '777') };
  const url = 'https://www.linkedin.com/company/ma-cible/';

  it('rend les posts de la page, en parcourant jusqu au total annonce', async () => {
    const { p } = piloteFactice([html, lot([1, 2], 4, 0), lot([3, 4], 4, 2)]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set(),
      budget: { requetesRestantes: 10, postsRestants: 10 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r.urns).toEqual([1, 2, 3, 4].map(page));
    expect(r.arret).toBe('fini');
  });

  // Le coeur de T2 : sans cette memoire, un suivi continu recollecte les memes posts a chaque
  // passage et brule le plafond du jour sans ajouter personne.
  it('ne rend jamais un post que cette source a deja traite', async () => {
    const { p } = piloteFactice([html, lot([1, 2, 3], 3, 0)]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set([page(1), page(3)]),
      budget: { requetesRestantes: 10, postsRestants: 10 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r.urns).toEqual([page(2)]);
  });

  it('s arrete au plafond de posts, en gardant ce qui est deja trouve', async () => {
    const { p } = piloteFactice([html, lot([1, 2, 3], 99, 0)]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set(),
      budget: { requetesRestantes: 10, postsRestants: 2 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r.urns).toEqual([page(1), page(2)]);
    expect(r.arret).toBe('plafond');
  });

  it('s arrete au budget de requetes sans rien perdre', async () => {
    // Deux requetes de budget : la resolution en prend une, il en reste une pour les posts.
    const { p, urls } = piloteFactice([html, lot([1, 2], 99, 0), lot([3, 4], 99, 2)]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set(),
      budget: { requetesRestantes: 2, postsRestants: 50 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r.urns).toEqual([page(1), page(2)]);
    expect(r.arret).toBe('plafond');
    expect(urls).toHaveLength(2);
  });

  it('un budget deja epuise ne fait partir aucune requete', async () => {
    const { p, urls } = piloteFactice([html]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set(),
      budget: { requetesRestantes: 0, postsRestants: 3 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r).toEqual({ urns: [], arret: 'plafond' });
    expect(urls).toHaveLength(0);
  });

  it('une page dont tous les posts sont deja traites se termine sur une liste vide', async () => {
    const { p } = piloteFactice([html, lot([1, 2], 2, 0)]);
    const r = await trouverPostsDePage(p, url, {
      dejaTraites: new Set([page(1), page(2)]),
      budget: { requetesRestantes: 10, postsRestants: 10 },
      surRequete: async () => undefined,
      pause: sansAttendre,
    });
    expect(r.urns).toEqual([]);
    expect(r.arret).toEqual({ type: 'liste_vide' });
  });
});

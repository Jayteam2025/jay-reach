import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adresseJoignable, identiteNavigateur, ouvrirNavigateur, releverSortie, releverTitulaire, type Pilote } from './navigateur.js';

// `puppeteer-core` n'est atteint que par un `import()` dynamique : le simuler ici
// n'oblige à changer aucune signature, et c'est le seul moyen d'exercer
// `ouvrirNavigateur`, qui tient la seule ressource de longue durée du lot.
const faux = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('puppeteer-core', () => ({
  default: { connect: faux.connect },
  TimeoutError: class TimeoutError extends Error {},
}));

type Reponse = { statut: number; corps: string } | Error;

/** Pilote factice : consigne chaque URL demandee et chaque navigation, rend la reponse scriptee. */
function pilote(reponses: Record<string, Reponse>): {
  p: Pilote;
  requetes: string[];
  pages: string[];
} {
  const requetes: string[] = [];
  const pages: string[] = [];
  const p: Pilote = {
    aller: async (url) => void pages.push(url),
    url: async () => 'about:blank',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    requete: async (url) => {
      requetes.push(url);
      const r = reponses[url];
      if (!r) throw new Error(`requete non prevue : ${url}`);
      if (r instanceof Error) throw r;
      return r;
    },
    fermer: async () => undefined,
  };
  return { p, requetes, pages };
}

const IPIFY = 'https://api.ipify.org?format=json';
const ipinfo = (ip: string) => `https://ipinfo.io/${ip}/json`;
const ok = (o: unknown): Reponse => ({ statut: 200, corps: JSON.stringify(o) });

afterEach(() => vi.restoreAllMocks());

describe('releverSortie', () => {
  it("charge l'echo PAR LE PILOTE et jamais par un fetch du processus", async () => {
    const fetchNode = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('fetch Node interdit'));
    const { p, requetes } = pilote({
      [IPIFY]: ok({ ip: '203.0.113.7' }),
      [ipinfo('203.0.113.7')]: ok({ org: 'AS64500 Exemple', country: 'fr' }),
    });
    const sortie = await releverSortie(p);
    expect(requetes).toEqual([IPIFY, ipinfo('203.0.113.7')]);
    expect(fetchNode).not.toHaveBeenCalled();
    expect(sortie).toEqual({ ip: '203.0.113.7', operateur: 'AS64500 Exemple', pays: 'FR' });
  });

  it("part d'une page neutre : une page LinkedIn bloquerait l'appel par sa CSP", async () => {
    const { p, pages } = pilote({
      [IPIFY]: ok({ ip: '203.0.113.7' }),
      [ipinfo('203.0.113.7')]: ok({}),
    });
    await releverSortie(p);
    expect(pages).toEqual(['about:blank']);
  });

  it("normalise l'IP : espaces retires, IPv6 en graphie canonique", async () => {
    const a = pilote({ [IPIFY]: ok({ ip: '  203.0.113.7 \n' }), [ipinfo('203.0.113.7')]: ok({}) });
    expect((await releverSortie(a.p)).ip).toBe('203.0.113.7');
    const b = pilote({
      [IPIFY]: ok({ ip: '2001:0DB8:0000:0000:0000:0000:0000:0001' }),
      [ipinfo('2001:db8::1')]: ok({}),
    });
    expect((await releverSortie(b.p)).ip).toBe('2001:db8::1');
  });

  it.each([
    ['chaine vide', ok({ ip: '' })],
    ['espaces seuls', ok({ ip: '   ' })],
    ['pas une IP', ok({ ip: 'pas-une-ip' })],
    ['IPv4 hors plage', ok({ ip: '999.1.1.1' })],
    ['champ absent', ok({ adresse: '203.0.113.7' })],
    ['corps non JSON', { statut: 200, corps: '<html>' }],
    ['statut 500', { statut: 500, corps: JSON.stringify({ ip: '203.0.113.7' }) }],
  ] as [string, Reponse][])('echoue franchement sur : %s', async (_nom, reponse) => {
    const { p } = pilote({ [IPIFY]: reponse });
    await expect(releverSortie(p)).rejects.toThrow();
  });

  it("echoue quand l'appel de la page echoue, sans reprendre le message d'origine", async () => {
    const { p } = pilote({
      [IPIFY]: new Error('net::ERR_PROXY_CONNECTION_FAILED http://u:mdp@proxy:8080'),
    });
    const erreur = await releverSortie(p).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect(String((erreur as Error).message)).not.toMatch(/mdp|proxy|u:/);
    expect((erreur as Error).cause).toBeUndefined();
  });

  it("garde l'IP quand le service d'enrichissement echoue ou rend n'importe quoi", async () => {
    for (const rep of [
      new Error('boom'),
      { statut: 429, corps: '' },
      { statut: 200, corps: 'xx' },
      ok({ org: 42 }),
    ]) {
      const { p } = pilote({ [IPIFY]: ok({ ip: '203.0.113.7' }), [ipinfo('203.0.113.7')]: rep });
      expect(await releverSortie(p)).toEqual({ ip: '203.0.113.7' });
    }
  });

  it("ignore un pays qui n'a pas deux lettres et un operateur vide", async () => {
    const { p } = pilote({
      [IPIFY]: ok({ ip: '203.0.113.7' }),
      [ipinfo('203.0.113.7')]: ok({ org: '  ', country: 'France' }),
    });
    expect(await releverSortie(p)).toEqual({ ip: '203.0.113.7' });
  });
});

describe('adresseJoignable', () => {
  it("remplace le nom d'hote par son IP : le DevTools de Chromium refuse un Host qui n'est pas une IP", async () => {
    const lookup = vi.fn(async () => ({ address: '172.18.0.4', family: 4 }));
    expect(await adresseJoignable('http://navigateur:9223', lookup)).toBe('http://172.18.0.4:9223');
    expect(lookup).toHaveBeenCalledWith('navigateur');
  });

  it('laisse une IP telle quelle, sans resolution', async () => {
    const lookup = vi.fn();
    expect(await adresseJoignable('http://127.0.0.1:9222', lookup)).toBe('http://127.0.0.1:9222');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('met une IPv6 resolue entre crochets', async () => {
    const lookup = vi.fn(async () => ({ address: 'fd00::4', family: 6 }));
    expect(await adresseJoignable('http://navigateur:9223', lookup)).toBe('http://[fd00::4]:9223');
  });
});

describe('identiteNavigateur', () => {
  it('annonce Chrome et la version reelle, jamais HeadlessChrome, en-tetes Sec-CH-UA compris', () => {
    const id = identiteNavigateur('HeadlessChrome/129.0.6668.89');
    expect(id?.userAgent).toMatch(/Chrome\/129\.0\.6668\.89 /);
    expect(JSON.stringify(id)).not.toMatch(/Headless/i);
    expect(id?.userAgentMetadata.brands[0]).toEqual({ brand: 'Chromium', version: '129' });
    expect(id?.userAgentMetadata.fullVersionList[0]).toEqual({
      brand: 'Chromium',
      version: '129.0.6668.89',
    });
    expect(id?.userAgentMetadata.platform).toBe('Linux');
  });

  it('ne touche a rien quand la version est illisible', () => {
    expect(identiteNavigateur('inconnu')).toBeNull();
  });
});

describe('ouvrirNavigateur rend toujours la connexion CDP', () => {
  // IP littérale : `adresseJoignable` court-circuite alors le DNS.
  const URL_CDP = 'http://127.0.0.1:9223';

  beforeEach(() => {
    faux.connect.mockReset();
    process.env.LINKEDIN_BROWSER_URL = URL_CDP;
    delete process.env.LINKEDIN_PROXY_USER;
    delete process.env.LINKEDIN_PROXY_PASSWORD;
  });
  afterEach(() => {
    delete process.env.LINKEDIN_BROWSER_URL;
  });

  /** Chaque panne porte son NOM : trois causes, trois remèdes, trois messages. */
  async function nomDeLErreur(agir: () => Promise<unknown>): Promise<string> {
    try {
      await agir();
      return 'aucune erreur';
    } catch (e) {
      return e instanceof Error ? e.name : 'inconnue';
    }
  }

  it('nomme la variable absente', async () => {
    delete process.env.LINKEDIN_BROWSER_URL;
    expect(await nomDeLErreur(() => ouvrirNavigateur())).toBe('UrlNavigateurAbsente');
  });

  it('nomme un conteneur injoignable', async () => {
    faux.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect(await nomDeLErreur(() => ouvrirNavigateur())).toBe('ConnexionNavigateur');
  });

  it('rend la connexion quand newPage leve, et n ouvre aucun onglet', async () => {
    const disconnect = vi.fn(async () => undefined);
    const newPage = vi.fn(async () => {
      throw new Error('Target closed');
    });
    faux.connect.mockResolvedValue({ newPage, disconnect, version: async () => 'Chromium/129.0.6668.89' });
    expect(await nomDeLErreur(() => ouvrirNavigateur())).toBe('PreparationNavigateur');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('ferme l onglet ET rend la connexion quand l authentification du proxy leve', async () => {
    // Le cas du premier déploiement : LINKEDIN_PROXY_PASSWORD faux.
    process.env.LINKEDIN_PROXY_USER = 'u';
    process.env.LINKEDIN_PROXY_PASSWORD = 'mauvais';
    const close = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const page = {
      setDefaultTimeout: vi.fn(),
      setUserAgent: vi.fn(async () => undefined),
      authenticate: vi.fn(async () => {
        throw new Error('Protocol error');
      }),
      close,
    };
    faux.connect.mockResolvedValue({
      newPage: async () => page,
      disconnect,
      version: async () => 'Chromium/129.0.6668.89',
    });
    expect(await nomDeLErreur(() => ouvrirNavigateur())).toBe('PreparationNavigateur');
    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('ne reprend jamais la valeur du mot de passe de proxy dans le message', async () => {
    process.env.LINKEDIN_PROXY_USER = 'u';
    process.env.LINKEDIN_PROXY_PASSWORD = 'mdp-secret';
    faux.connect.mockRejectedValue(new Error('proxy http://u:mdp-secret@exemple:8080 refuse'));
    try {
      await ouvrirNavigateur();
      expect.unreachable();
    } catch (e) {
      expect(`${(e as Error).name}${(e as Error).message}`).not.toContain('mdp-secret');
    }
  });
});

describe('une navigation en cours ne fait pas echouer la commande', () => {
  const URL_CDP = 'http://127.0.0.1:9223';
  // Le message exact de puppeteer, releve le 07/10 sur le navigateur du serveur en provoquant
  // une navigation pendant un `evaluateHandle`. Son `name` est `Error` : rien ne le distingue
  // d'une panne, d'ou le filtrage sur le message.
  const NAVIGATION = 'Execution context was destroyed, most likely because of a navigation.';

  function piloteAvec(evaluateHandle: () => Promise<unknown>): Promise<Pilote> {
    const page = {
      setDefaultTimeout: () => undefined,
      setUserAgent: async () => undefined,
      authenticate: async () => undefined,
      waitForFunction: async () => undefined,
      evaluateHandle,
      keyboard: { press: async () => undefined },
      close: async () => undefined,
    };
    faux.connect.mockResolvedValue({
      newPage: async () => page,
      disconnect: async () => undefined,
      version: async () => 'Chromium/129.0.6668.89',
    });
    return ouvrirNavigateur();
  }

  /** Une poignee d'element factice : `asElement` rend l'objet, `evaluate` son texte. */
  const poignee = (texte: string) => {
    const element = {
      evaluate: async () => texte,
      dispose: async () => undefined,
      type: async () => undefined,
      focus: async () => undefined,
    };
    return { asElement: () => element, dispose: async () => undefined };
  };

  beforeEach(() => {
    faux.connect.mockReset();
    process.env.LINKEDIN_BROWSER_URL = URL_CDP;
    delete process.env.LINKEDIN_PROXY_USER;
    delete process.env.LINKEDIN_PROXY_PASSWORD;
  });
  afterEach(() => {
    delete process.env.LINKEDIN_BROWSER_URL;
  });

  it('texte rend la chaine vide quand la page navigue, au lieu de lever', async () => {
    const pilote = await piloteAvec(async () => {
      throw new Error(NAVIGATION);
    });
    // Sans cela, une connexion REUSSIE echouait : LinkedIn redirige vers /feed pendant que
    // la boucle lit la region d'alerte.
    expect(await pilote.texte('[aria-live="assertive"]')).toBe('');
  });

  it('texte laisse passer une vraie panne', async () => {
    const pilote = await piloteAvec(async () => {
      throw new Error('Protocol error: connexion CDP perdue');
    });
    await expect(pilote.texte('[aria-live="assertive"]')).rejects.toThrow('Protocol error');
  });

  it('saisir rejoue une fois sur le document arrive', async () => {
    let appels = 0;
    const pilote = await piloteAvec(async () => {
      appels += 1;
      if (appels === 1) throw new Error(NAVIGATION);
      return poignee('');
    });
    await pilote.saisir('input[autocomplete="current-password"]', 'secret');
    expect(appels).toBe(2);
  });

  it('saisir ne rejoue pas indefiniment', async () => {
    let appels = 0;
    const pilote = await piloteAvec(async () => {
      appels += 1;
      throw new Error(NAVIGATION);
    });
    await expect(pilote.saisir('input', 'secret')).rejects.toThrow(NAVIGATION);
    expect(appels).toBe(2);
  });

  it('presserEntree rejoue une fois sur le document arrive', async () => {
    let appels = 0;
    const pilote = await piloteAvec(async () => {
      appels += 1;
      if (appels === 1) throw new Error(NAVIGATION);
      return poignee('');
    });
    await pilote.presserEntree('input[autocomplete="current-password"]');
    expect(appels).toBe(2);
  });
});

describe('releverTitulaire', () => {
  const URL_RDAP = 'https://rdap.db.ripe.net/ip/185.134.193.162';
  const adr = (label: string) => ['adr', { label }, 'text', ['', '', '', '', '', '', '']];
  const rdap = {
    name: 'NADEJDA-NET',
    country: 'FR',
    entities: [
      {
        vcardArray: ['vcard', [['version', {}, 'text', '4.0'], adr('Sofia, Bulgaria\nKukush Str., Bl.58')]],
        entities: [
          { vcardArray: ['vcard', [['adr', {}, 'text', ['', '', 'Nadejda.Net Ltd', 'Sofia', '', '1233', 'BULGARIA']]]] },
          { vcardArray: ['vcard', [adr('Sofia, Bulgaria  Kukush Str., Bl.58')]] },
        ],
      },
    ],
  };

  it('extrait nom, pays declare et adresses, y compris celles des entites imbriquees', async () => {
    const { p, requetes } = pilote({ [URL_RDAP]: { statut: 200, corps: JSON.stringify(rdap) } });
    const t = await releverTitulaire(p, '185.134.193.162');
    expect(requetes).toEqual([URL_RDAP]);
    expect(t?.nom).toBe('NADEJDA-NET');
    expect(t?.paysDeclare).toBe('FR');
    expect(t?.adresses).toEqual(['Sofia, Bulgaria Kukush Str., Bl.58', 'Nadejda.Net Ltd Sofia 1233 BULGARIA']);
  });

  it('rend null sur un statut non 200', async () => {
    const { p } = pilote({ [URL_RDAP]: { statut: 404, corps: '{}' } });
    expect(await releverTitulaire(p, '185.134.193.162')).toBeNull();
  });

  it('rend null sur un corps illisible', async () => {
    const { p } = pilote({ [URL_RDAP]: { statut: 200, corps: '<html>' } });
    expect(await releverTitulaire(p, '185.134.193.162')).toBeNull();
  });

  it('rend null sur un schema inattendu', async () => {
    const { p } = pilote({ [URL_RDAP]: { statut: 200, corps: JSON.stringify({ entities: 'non' }) } });
    expect(await releverTitulaire(p, '185.134.193.162')).toBeNull();
  });

  it('ne leve jamais sur une panne reseau', async () => {
    const { p } = pilote({ [URL_RDAP]: new Error('http://user:secret@proxy:1080 refuse') });
    await expect(releverTitulaire(p, '185.134.193.162')).resolves.toBeNull();
  });
});

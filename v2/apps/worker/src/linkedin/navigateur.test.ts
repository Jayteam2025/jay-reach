import { afterEach, describe, expect, it, vi } from 'vitest';
import { adresseJoignable, releverSortie, type Pilote } from './navigateur.js';

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
    cliquer: async () => undefined,
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

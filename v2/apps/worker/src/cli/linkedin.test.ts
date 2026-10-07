import { describe, expect, it, vi } from 'vitest';
import type { Contexte, Sortie, Titulaire } from '@jay-reach/core';
import type { Pilote } from '../linkedin/navigateur.js';
import { executerCommande, type Dependances } from './linkedin.js';

interface Appel {
  sql: string;
  params: unknown[];
}

type Ligne = Record<string, unknown>;

function ligneSession(o: Partial<Ligne> = {}): Ligne {
  return {
    status: 'active',
    blocked_reason: null,
    connected_at: new Date('2026-10-05T08:00:00Z'),
    blocked_at: null,
    expected_egress_ip: '203.0.113.7',
    last_egress_ip: '203.0.113.7',
    last_egress_org: 'AS64500 Exemple',
    last_egress_country: 'FR',
    last_collect_at: null,
    ...o,
  };
}

/** Contexte factice : `session` repond a la lecture, tout le reste reussit et est consigne. */
function ctxFaux(session: Ligne | null): { ctx: Contexte; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (/linkedin_session_lire/.test(sql))
      return { rows: session ? [session] : [], rowCount: session ? 1 : 0 };
    return { rows: [{}], rowCount: 1 };
  });
  return {
    ctx: {
      ex: { query } as unknown as Contexte['ex'],
      organisationId: 'org-1',
      utilisateurId: null,
      role: null,
    },
    appels,
  };
}

/**
 * Pilote factice : `urls` est la suite des URL rendues (la derniere se repete), `presents` les
 * selecteurs trouves, `textes` le texte rendu par selecteur (vide si absent).
 */
const CODE = 'input[autocomplete="one-time-code"], input[name="pin"]';
const ERREUR = '[aria-live="assertive"]';

function piloteFaux(
  urls: string[] = [],
  presents: string[] = [],
  textes: Record<string, string> = {},
): { p: Pilote; saisies: [string, string][]; entrees: string[] } {
  const saisies: [string, string][] = [];
  const entrees: string[] = [];
  const file = [...urls];
  const p: Pilote = {
    aller: vi.fn(async () => undefined),
    url: async () => (file.length > 1 ? file.shift()! : (file[0] ?? 'about:blank')),
    saisir: async (s, v) => void saisies.push([s, v]),
    presserEntree: async (s) => void entrees.push(s),
    texte: async (s) => textes[s] ?? '',
    attendre: async (s) => presents.includes(s),
    requete: async () => ({ statut: 200, corps: '' }),
    fermer: vi.fn(async () => undefined),
  };
  return { p, saisies, entrees };
}

function dependances(o: {
  env?: Record<string, string>;
  session?: Ligne | null;
  pilote?: Pilote;
  sortie?: Sortie;
  titulaire?: Titulaire | null | Error;
  ipServeur?: string;
  demander?: (i: string) => Promise<string>;
  demanderMasque?: (i: string) => Promise<string>;
}): {
  d: Dependances;
  sortie: string[];
  appels: Appel[];
  ouvrir: ReturnType<typeof vi.fn>;
  contexte: ReturnType<typeof vi.fn>;
} {
  const { ctx, appels } = ctxFaux(o.session ?? null);
  const sortie: string[] = [];
  const ouvrir = vi.fn(async () => {
    if (!o.pilote) throw new Error('navigateur non prevu');
    return o.pilote;
  });
  const contexte = vi.fn(async () => ctx);
  const interdit = (nom: string) => async (): Promise<string> => {
    throw new Error(`${nom} ne doit pas etre appele`);
  };
  return {
    d: {
      env: o.env ?? {},
      ecrire: (l) => void sortie.push(l),
      contexte,
      ouvrirNavigateur: ouvrir,
      releverSortie: async () => o.sortie ?? { ip: '203.0.113.7' },
      releverTitulaire: async () => {
        if (o.titulaire instanceof Error) throw o.titulaire;
        return o.titulaire ?? null;
      },
      ipDuProcessus: async () => o.ipServeur ?? '10.255.255.1',
      demander: o.demander ?? interdit('demander'),
      demanderMasque: o.demanderMasque ?? interdit('demanderMasque'),
      pause: async () => undefined,
    },
    sortie,
    appels,
    ouvrir,
    contexte,
  };
}

const ACTIF = { JAY_REACH_LINKEDIN: '1' };

describe('la commande statut', () => {
  it("affiche l'etat sans demander d'identifiants ni ouvrir le navigateur", async () => {
    const { d, sortie, ouvrir } = dependances({ session: ligneSession() });
    const code = await executerCommande(['statut'], d);
    expect(code).toBe(0);
    expect(ouvrir).not.toHaveBeenCalled();
    const texte = sortie.join('\n');
    expect(texte).toMatch(/active/);
    expect(texte).toMatch(/203\.0\.113\.7/);
  });

  it("dit 'absente' quand aucune session n'existe, et fonctionne sans JAY_REACH_LINKEDIN", async () => {
    const { d, sortie } = dependances({ session: null, env: {} });
    expect(await executerCommande(['statut'], d)).toBe(0);
    expect(sortie.join('\n')).toMatch(/absente/);
  });

  it('affiche le motif quand la session est bloquee', async () => {
    const { d, sortie } = dependances({
      session: ligneSession({ status: 'bloquee', blocked_reason: 'defi' }),
    });
    await executerCommande(['statut'], d);
    expect(sortie.join('\n')).toMatch(/bloquee/);
    expect(sortie.join('\n')).toMatch(/defi/);
  });
});

describe('la commande connecter', () => {
  it("refuse si JAY_REACH_LINKEDIN n'est pas pose, avant toute base ou navigateur", async () => {
    const { d, sortie, ouvrir, contexte } = dependances({ env: {} });
    const code = await executerCommande(['connecter'], d);
    expect(code).not.toBe(0);
    expect(sortie.join('\n')).toMatch(/JAY_REACH_LINKEDIN/);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(contexte).not.toHaveBeenCalled();
  });

  it('refuse aussi quand la variable vaut autre chose que 1', async () => {
    const { d, ouvrir } = dependances({ env: { JAY_REACH_LINKEDIN: '0' } });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    expect(ouvrir).not.toHaveBeenCalled();
  });

  it("fige l'IP attendue sur la sortie vue quand elle est vide, et n'ecrit aucun secret", async () => {
    const { p, saisies } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/feed/',
    ]);
    const { d, sortie, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      sortie: { ip: '198.51.100.9' },
      demander: async () => 'moi@exemple.fr',
      demanderMasque: async () => 'mot-de-passe-secret',
    });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    const activation = appels.find(
      (a) =>
        /status\s*,?.*'active'|'active'/.test(a.sql) && /jr:linkedin_session_activer/.test(a.sql),
    );
    expect(activation?.params).toEqual(['org-1', '198.51.100.9']);
    // La relève consigne ce que l'écran affichera (last_egress_*), dès la première connexion.
    expect(appels.find((a) => /jr:linkedin_session_observer/.test(a.sql))?.params).toEqual([
      'org-1',
      '198.51.100.9',
      null,
      null,
    ]);
    expect(saisies).toContainEqual(['input[autocomplete="current-password"]', 'mot-de-passe-secret']);
    const tout = JSON.stringify([sortie, appels]);
    expect(tout).not.toMatch(/mot-de-passe-secret/);
    expect(tout).not.toMatch(/moi@exemple\.fr/);
  });

  it("garde l'IP attendue existante quand la sortie est conforme", async () => {
    const { p } = piloteFaux(['https://www.linkedin.com/login', 'https://www.linkedin.com/feed/']);
    const { d, appels } = dependances({
      env: ACTIF,
      session: ligneSession({
        status: 'bloquee',
        blocked_reason: 'cookie_refuse',
        expected_egress_ip: '203.0.113.7',
      }),
      pilote: p,
      sortie: { ip: '203.0.113.7' },
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    expect(appels.find((a) => /jr:linkedin_session_activer/.test(a.sql))?.params).toEqual([
      'org-1',
      '203.0.113.7',
    ]);
  });

  it("refuse de figer l'IP du serveur : le navigateur sort en direct, pas par le proxy", async () => {
    const { p, saisies } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/feed/',
    ]);
    const { d, sortie, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      sortie: { ip: '198.51.100.9' },
      ipServeur: '198.51.100.9',
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    expect(saisies).toEqual([]);
    expect(appels.some((a) => /jr:linkedin_session_activer/.test(a.sql))).toBe(false);
    expect(sortie.join('\n')).toMatch(/IP du serveur/);
    // La relève a déjà été consignée : ne pas affirmer que « rien » n'est enregistré.
    expect(sortie.join('\n')).toMatch(/IP attendue n’est pas posée/);
    expect(sortie.join('\n')).not.toMatch(/rien n’est enregistré/i);
  });

  it("n'ouvre ni ne demande rien quand le profil est deja connecte", async () => {
    const { p, saisies } = piloteFaux(['https://www.linkedin.com/feed/']);
    const { d, appels } = dependances({ env: ACTIF, session: null, pilote: p });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    expect(saisies).toEqual([]);
    expect(appels.some((a) => /jr:linkedin_session_activer/.test(a.sql))).toBe(true);
  });

  it('au delai, annonce le chemin atteint et non un mot de passe incorrect', async () => {
    const { p } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/check/add-phone?token=secret',
    ]);
    const { d, sortie, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    const texte = sortie.join('\n');
    expect(texte).toMatch(/\/check\/add-phone/);
    expect(texte).not.toMatch(/incorrect/);
    expect(texte).not.toMatch(/rien n’est enregistré/i);
    expect(texte).toMatch(/session n’est pas activée/);
    expect(texte).not.toMatch(/secret/);
    expect(appels.some((a) => /jr:linkedin_session_(activer|bloquer)/.test(a.sql))).toBe(false);
  });

  it('laisse dix secondes au champ du code avant de conclure a un defi', async () => {
    const delais: number[] = [];
    const { p } = piloteFaux(
      [
        'https://www.linkedin.com/login',
        'https://www.linkedin.com/checkpoint/x',
        'https://www.linkedin.com/feed/',
      ],
      [CODE],
    );
    const attendre = p.attendre;
    p.attendre = async (s, ms) => (delais.push(ms), attendre(s, ms));
    const { d } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => '1',
    });
    await executerCommande(['connecter'], d);
    expect(delais).toContain(10_000);
  });

  it("n'ouvre pas LinkedIn quand la sortie n'est pas celle attendue, et bloque la session", async () => {
    const { p, saisies } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/feed/',
    ]);
    const { d, appels } = dependances({
      env: ACTIF,
      session: ligneSession({ expected_egress_ip: '203.0.113.7' }),
      pilote: p,
      sortie: { ip: '192.0.2.55' },
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    expect(saisies).toEqual([]);
    expect(p.aller).not.toHaveBeenCalledWith(expect.stringContaining('linkedin.com'));
    expect(
      appels.some(
        (a) => /jr:linkedin_session_bloquer/.test(a.sql) && a.params.includes('sortie_inattendue'),
      ),
    ).toBe(true);
    expect(p.fermer).toHaveBeenCalled();
  });

  it('demande le code masque quand LinkedIn en reclame un, puis aboutit', async () => {
    const { p, saisies } = piloteFaux(
      [
        'https://www.linkedin.com/login',
        'https://www.linkedin.com/checkpoint/challenge/abc',
        'https://www.linkedin.com/checkpoint/challenge/abc',
        'https://www.linkedin.com/feed/',
      ],
      [CODE],
    );
    const masque = vi.fn(async (i: string) => (/code/i.test(i) ? '123456' : 'mdp'));
    const { d, sortie, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: masque,
    });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    expect(saisies).toContainEqual([CODE, '123456']);
    expect(JSON.stringify([sortie, appels])).not.toMatch(/123456/);
  });

  it('bloque en defi quand LinkedIn pose une verification que le terminal ne sait pas passer', async () => {
    const { p } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/checkpoint/challenge/abc',
    ]);
    const { d, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    expect(
      appels.some((a) => /jr:linkedin_session_bloquer/.test(a.sql) && a.params.includes('defi')),
    ).toBe(true);
  });

  it('saisit identifiant puis mot de passe, et presse Entree sur le mot de passe, pas sur un bouton', async () => {
    const { p, saisies, entrees } = piloteFaux([
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/feed/',
    ]);
    const { d } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'mdp',
    });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    expect(saisies).toEqual([
      ['input[autocomplete^="username"]', 'a@b.fr'],
      ['input[autocomplete="current-password"]', 'mdp'],
    ]);
    expect(entrees).toEqual(['input[autocomplete="current-password"]']);
  });

  it.each(['', '   ', '\n\t '])(
    'une region aria-live presente mais vide (%j) ne donne pas refuse : etat normal avant soumission',
    async (vide) => {
      const { p } = piloteFaux(['https://www.linkedin.com/login'], [ERREUR], { [ERREUR]: vide });
      const { d, sortie, appels } = dependances({
        env: ACTIF,
        session: null,
        pilote: p,
        demander: async () => 'a@b.fr',
        demanderMasque: async () => 'x',
      });
      expect(await executerCommande(['connecter'], d)).not.toBe(0);
      expect(sortie.join('\n')).not.toMatch(/incorrect/);
      expect(appels.some((a) => /jr:linkedin_session_activer/.test(a.sql))).toBe(false);
    },
  );

  it("presse Entree sur le champ du code de verification", async () => {
    const { p, entrees } = piloteFaux(
      [
        'https://www.linkedin.com/login',
        'https://www.linkedin.com/checkpoint/challenge/abc',
        'https://www.linkedin.com/feed/',
      ],
      [CODE],
    );
    const { d } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => '123456',
    });
    expect(await executerCommande(['connecter'], d)).toBe(0);
    expect(entrees).toEqual(['input[autocomplete="current-password"]', CODE]);
  });

  it("n'active ni ne bloque rien quand les identifiants sont refuses", async () => {
    const { p } = piloteFaux(
      ['https://www.linkedin.com/login'],
      [],
      { '[aria-live="assertive"]': 'Adresse e-mail ou mot de passe incorrect.' },
    );
    const { d, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    expect(appels.some((a) => /jr:linkedin_session_(activer|bloquer)/.test(a.sql))).toBe(false);
  });

  it('libere le verrou quand la saisie est interrompue (Ctrl+C)', async () => {
    const { p } = piloteFaux(['https://www.linkedin.com/login']);
    const { d, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => {
        throw new Error('Saisie interrompue');
      },
    });
    expect(await executerCommande(['connecter'], d)).not.toBe(0);
    const verrous = appels.filter((a) => /jr:linkedin_session_verrou/.test(a.sql));
    expect(verrous.at(-1)?.params[2]).toBe(0);
    expect(p.fermer).toHaveBeenCalled();
  });

  it("libere le verrou et ferme le navigateur meme en cas d'echec", async () => {
    const { p } = piloteFaux(
      ['https://www.linkedin.com/login'],
      [],
      { '[aria-live="assertive"]': 'Adresse e-mail ou mot de passe incorrect.' },
    );
    const { d, appels } = dependances({
      env: ACTIF,
      session: null,
      pilote: p,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    await executerCommande(['connecter'], d);
    const verrous = appels.filter((a) => /jr:linkedin_session_verrou/.test(a.sql));
    expect(verrous.length).toBe(2);
    expect(verrous[1]!.params[2]).toBe(0);
    expect(p.fermer).toHaveBeenCalled();
  });
});

describe('la commande ip', () => {
  it("n'ecrit pas l'IP attendue sans --confirmer", async () => {
    const { p } = piloteFaux();
    const { d, appels } = dependances({
      env: ACTIF,
      session: ligneSession(),
      pilote: p,
      sortie: { ip: '192.0.2.55' },
    });
    expect(await executerCommande(['ip'], d)).toBe(0);
    expect(appels.some((a) => /jr:linkedin_session_confirmer_ip/.test(a.sql))).toBe(false);
  });

  it('avec --confirmer, pose la sortie observee comme IP attendue', async () => {
    const { p } = piloteFaux();
    const { d, appels } = dependances({
      env: ACTIF,
      session: ligneSession(),
      pilote: p,
      sortie: { ip: '192.0.2.55' },
    });
    expect(await executerCommande(['ip', '--confirmer'], d)).toBe(0);
    expect(appels.find((a) => /jr:linkedin_session_confirmer_ip/.test(a.sql))?.params).toEqual([
      'org-1',
      '192.0.2.55',
    ]);
  });

  it("refuse de confirmer l'IP du serveur comme IP attendue", async () => {
    const { p } = piloteFaux();
    const { d, appels, sortie } = dependances({
      env: ACTIF,
      session: ligneSession(),
      pilote: p,
      sortie: { ip: '192.0.2.55' },
      ipServeur: '192.0.2.55',
    });
    expect(await executerCommande(['ip', '--confirmer'], d)).not.toBe(0);
    expect(sortie.join('\n')).toMatch(/IP attendue n’est pas posée/);
    expect(appels.some((a) => /jr:linkedin_session_confirmer_ip/.test(a.sql))).toBe(false);
  });

  it("consigne l'observation dans les deux cas", async () => {
    const { p } = piloteFaux();
    const { d, appels } = dependances({
      env: ACTIF,
      session: ligneSession(),
      pilote: p,
      sortie: { ip: '192.0.2.55' },
    });
    await executerCommande(['ip'], d);
    expect(appels.some((a) => /jr:linkedin_session_observer/.test(a.sql))).toBe(true);
  });
});

describe('la commande deconnecter', () => {
  it('revoque la session', async () => {
    const { p } = piloteFaux();
    const { d, appels } = dependances({ env: ACTIF, session: ligneSession(), pilote: p });
    expect(await executerCommande(['deconnecter'], d)).toBe(0);
    expect(
      appels.some(
        (a) => /jr:linkedin_session_bloquer/.test(a.sql) && a.params.includes('revoquee'),
      ),
    ).toBe(true);
  });

  it('revoque quand meme si le navigateur est injoignable', async () => {
    const { d, appels } = dependances({ env: ACTIF, session: ligneSession() });
    expect(await executerCommande(['deconnecter'], d)).toBe(0);
    expect(appels.some((a) => a.params.includes('revoquee'))).toBe(true);
  });
});

describe("l'usage", () => {
  it('refuse une commande inconnue et un argument superflu', async () => {
    const a = dependances({});
    expect(await executerCommande(['pirater'], a.d)).toBe(2);
    const b = dependances({ session: null });
    expect(await executerCommande(['statut', '--mot-de-passe=x'], b.d)).toBe(2);
  });
});

describe('le titulaire de l’IP', () => {
  const SOFIA = {
    nom: 'NADEJDA-NET',
    paysDeclare: 'FR',
    adresses: ['Sofia, Bulgaria Kukush Str., Bl.58'],
  };
  const PARIS = { nom: 'Orange', paysDeclare: 'FR', adresses: ['Paris, France'] };

  async function jouer(commande: string[], titulaire: Titulaire | null | Error) {
    const { p } = piloteFaux(['https://www.linkedin.com/login', 'https://www.linkedin.com/feed/']);
    const r = dependances({
      env: ACTIF,
      session: ligneSession(),
      pilote: p,
      sortie: { ip: '203.0.113.7' },
      titulaire,
      demander: async () => 'a@b.fr',
      demanderMasque: async () => 'x',
    });
    const code = await executerCommande(commande, r.d);
    return { code, texte: r.sortie.join('\n'), appels: r.appels.map((a) => [a.sql, a.params]) };
  }

  for (const commande of [['ip'], ['connecter']]) {
    describe(`avec « ${commande[0]} »`, () => {
      it('nomme le titulaire et avertit en cas de desaccord, sans rien changer d’autre', async () => {
        const sans = await jouer(commande, null);
        const avec = await jouer(commande, SOFIA);
        expect(avec.texte).toMatch(/NADEJDA-NET/);
        expect(avec.texte).toMatch(/Attention : .*France.*Sofia, Bulgaria/);
        expect(avec.code).toBe(sans.code);
        expect(avec.appels).toEqual(sans.appels);
      });

      it('n’avertit pas quand l’adresse confirme le pays', async () => {
        const r = await jouer(commande, PARIS);
        expect(r.texte).toMatch(/Orange/);
        expect(r.texte).not.toMatch(/Attention/);
      });

      it('ignore une panne du registre', async () => {
        const sans = await jouer(commande, null);
        const r = await jouer(commande, new Error('http://u:secret@proxy:1080'));
        expect(r.code).toBe(sans.code);
        expect(r.texte).not.toMatch(/secret|Titulaire/);
      });
    });
  }
});

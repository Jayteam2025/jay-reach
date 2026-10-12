import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { Pilote } from './navigateur.js';
import { executerCommande } from '../cli/linkedin.js';
import {
  dependancesWeb,
  ErreurDelaiCode,
  ErreurDemandeInterrompue,
  FENETRE_CODE_WEB_MS,
} from './dependances-web.js';

const CODE = 'input[autocomplete="one-time-code"], input[name="pin"]';
const SECRETS = { identifiant: 'moi@exemple.fr', motDePasse: 'mdp-super-secret' };
const ETAPES = ['sortie_controlee', 'navigateur_ouvert', 'identifiants_transmis', 'code_demande', 'session_active'];

interface Appel {
  sql: string;
  params: unknown[];
}

/** Pool factice : l'état de la demande est lu depuis `etat.enCours`, tout le reste réussit. */
function poolFaux(etat: { enCours: boolean }) {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (/select \(statut in/.test(sql)) return { rows: [{ ok: etat.enCours }], rowCount: 1 };
    if (/select organization_id/.test(sql)) return { rows: [{ organization_id: 'org-1' }], rowCount: 1 };
    if (/linkedin_session_lire/.test(sql)) return { rows: [], rowCount: 0 };
    return { rows: [{}], rowCount: 1 };
  });
  return { pool: { query } as unknown as pg.Pool, appels };
}

function piloteFaux(urls: string[], presents: string[] = []) {
  const saisies: [string, string][] = [];
  const file = [...urls];
  const p: Pilote = {
    aller: vi.fn(async () => undefined),
    url: async () => (file.length > 1 ? file.shift()! : (file[0] ?? 'about:blank')),
    saisir: async (s, v) => void saisies.push([s, v]),
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async (s) => presents.includes(s),
    requete: async () => ({ statut: 200, corps: '' }),
    effacerCookies: vi.fn(async () => undefined),
    fermer: vi.fn(async () => undefined),
  };
  return { p, saisies };
}

function monter(o: { pilote?: Pilote; enCours?: boolean; pause?: (ms: number) => Promise<void>; fenetreCodeMs?: number }) {
  const etat = { enCours: o.enCours ?? true };
  const { pool, appels } = poolFaux(etat);
  const ouvrir = vi.fn(async () => {
    if (!o.pilote) throw new Error('navigateur non prevu');
    return o.pilote;
  });
  const d = dependancesWeb('demande-1', SECRETS, pool, {
    env: { JAY_REACH_LINKEDIN: '1' },
    fenetreCodeMs: o.fenetreCodeMs,
    base: {
      ouvrirNavigateur: ouvrir,
      releverSortie: async () => ({ ip: '203.0.113.7' }),
      releverTitulaire: async () => null,
      ipDuProcessus: async () => '10.255.255.1',
      pause: o.pause ?? (async () => undefined),
    },
  });
  return { d, etat, appels, ouvrir };
}

const ecrituresEtat = (appels: Appel[]) => appels.filter((a) => /update linkedin_connexion_demandes/.test(a.sql));

describe('dependancesWeb', () => {
  it("l'identifiant et le mot de passe sont rendus sans attente", async () => {
    const { d } = monter({});
    expect(await d.demander('identifiant')).toBe(SECRETS.identifiant);
    expect(await d.demanderMasque('motDePasse')).toBe(SECRETS.motDePasse);
  });

  it("le code passe la demande en code_demande puis attend la notification", async () => {
    const { d, appels } = monter({});
    const attente = d.demanderMasque('code');
    await d.vider();
    expect(ecrituresEtat(appels).at(-1)?.params).toEqual(['demande-1', 'code_demande', 'code_demande', null, FENETRE_CODE_WEB_MS]);
    d.livrerCode('654321');
    expect(await attente).toBe('654321');
  });

  it('un code arrivé avant la question est gardé', async () => {
    const { d } = monter({});
    d.livrerCode('111111');
    expect(await d.demanderMasque('code')).toBe('111111');
  });

  it('la fenetre du code expire a cinq minutes (le CLI garde ses 90 s)', async () => {
    expect(FENETRE_CODE_WEB_MS).toBe(300_000);
    let ecoule = 0;
    const { d } = monter({ pause: async (ms) => void (ecoule += ms) });
    const e = await d.demanderMasque('code').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurDelaiCode);
    expect(ecoule).toBe(300_000);
  });

  it("une demande annulee pendant l'attente du code l'interrompt", async () => {
    const { d, etat } = monter({ pause: async () => void (etat.enCours = false) });
    expect(await d.demanderMasque('code').catch((x: unknown) => x)).toBeInstanceOf(ErreurDemandeInterrompue);
  });

  it("ecrire met a jour l'etape sans jamais porter de secret", async () => {
    const { p } = piloteFaux(
      ['https://www.linkedin.com/login', 'https://www.linkedin.com/checkpoint/c', 'https://www.linkedin.com/feed/'],
      [CODE],
    );
    const { d, appels } = monter({ pilote: p, pause: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1))) });
    const code = vi.spyOn(d, 'demanderMasque');
    setTimeout(() => d.livrerCode('987654'), 0);
    expect(await executerCommande(['connecter'], d)).toBe(0);
    await d.vider();
    expect(code).toHaveBeenCalledWith('code');
    d.ecrire('Sortie du navigateur : 203.0.113.7 · secret-operateur');
    d.ecrire(`texte libre avec ${SECRETS.motDePasse}`);
    await d.vider();
    const maj = ecrituresEtat(appels);
    const etapes = maj.map((a) => a.params[1]).filter((x) => x !== null);
    expect(etapes.length).toBeGreaterThan(0);
    for (const e of etapes) expect(ETAPES).toContain(e);
    expect(etapes).toContain('session_active');
    for (const a of maj) expect(JSON.stringify(a.params)).not.toMatch(/mdp-super-secret|987654|moi@exemple|203\.0\.113/);
  });

  it("une demande annulee interrompt avant d'ouvrir le navigateur", async () => {
    const { p } = piloteFaux(['https://www.linkedin.com/login']);
    const { d, ouvrir } = monter({ pilote: p, enCours: false });
    expect(await executerCommande(['connecter'], d)).toBe(1);
    expect(ouvrir).not.toHaveBeenCalled();
  });

  it("un defi sans champ de code echoue tout de suite en defi", async () => {
    const { p } = piloteFaux(['https://www.linkedin.com/login', 'https://www.linkedin.com/checkpoint/mobile'], []);
    const { d, appels } = monter({ pilote: p });
    const code = vi.spyOn(d, 'demanderMasque');
    expect(await executerCommande(['connecter'], d)).toBe(1);
    await d.vider();
    expect(code).not.toHaveBeenCalledWith('code');
    expect(ecrituresEtat(appels).at(-1)?.params).toEqual(['demande-1', null, 'echec', 'defi', null]);
  });
});

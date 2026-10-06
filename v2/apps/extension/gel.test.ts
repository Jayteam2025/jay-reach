import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// L'extension est gelee (lot 4a, tache 10) : le travail LinkedIn passe par le
// serveur. Le code reste en place (regle 1), mais aucune porte ne doit s'ouvrir.
// Ces tests ferment la porte pour de bon : un gel non teste se defait a la
// premiere modification.

const lire = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const manifeste = JSON.parse(lire('./manifest.json')) as {
  content_scripts: { matches: string[]; js: string[] }[];
  externally_connectable: { matches: string[] };
};

const ORIGINES_REELLES = ['http://localhost:3000', 'https://app.jay-reach.fr', 'https://jay-reach.vercel.app'];
// Chemins que l'application sert reellement ou a servi : aucun motif gele ne doit les couvrir.
const CHEMINS_REELS = ['/settings/linkedin', '/settings/senders', '/settings', '/'];

function correspond(motif: string, url: string): boolean {
  const m = /^(https?):\/\/([^/]+)(\/.*)$/.exec(motif);
  if (!m) return false;
  const u = new URL(url);
  const chemin = m[3]!.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return u.protocol === `${m[1]}:` && u.host === m[2] && new RegExp(`^${chemin}$`).test(u.pathname + u.search);
}

describe('extension gelee : manifeste', () => {
  it('le motif d injection de content-oauth.js ne correspond a aucune URL reelle', () => {
    const script = manifeste.content_scripts.find((c) => c.js.includes('content-oauth.js'));
    expect(script).toBeDefined(); // gelee, pas supprimee
    for (const motif of script!.matches) {
      for (const o of ORIGINES_REELLES) for (const c of CHEMINS_REELS) expect(correspond(motif, o + c)).toBe(false);
    }
  });

  it('externally_connectable ne correspond a aucune origine reelle', () => {
    for (const motif of manifeste.externally_connectable.matches) {
      for (const o of ORIGINES_REELLES) for (const c of CHEMINS_REELS) expect(correspond(motif, o + c)).toBe(false);
    }
  });
});

describe('extension gelee : service worker', () => {
  function charger() {
    const appels = { alarmes: 0, fetch: 0, stockage: 0 };
    let externe: ((m: unknown, s: unknown, r: (x: unknown) => void) => unknown) | undefined;
    const evt = { addListener: () => undefined };
    const chrome = {
      alarms: { create: () => appels.alarmes++, clear: () => undefined, onAlarm: { addListener: (f: unknown) => void f } },
      runtime: { onInstalled: evt, onStartup: evt, onMessage: evt, onMessageExternal: { addListener: (f: typeof externe) => (externe = f) } },
      storage: {
        local: {
          get: (_k: unknown, cb: (v: object) => void) => cb({ extensionToken: 'jeton' }),
          set: (_p: unknown, cb?: () => void) => { appels.stockage++; cb?.(); },
          remove: (_k: unknown, cb?: () => void) => cb?.(),
        },
      },
    };
    runInNewContext(lire('./background.js'), {
      chrome, importScripts: () => undefined, console,
      fetch: () => { appels.fetch++; return Promise.reject(new Error('fetch interdit')); },
      setTimeout, Date, Promise,
    });
    return { appels, externe: () => externe };
  }

  it('ne pose aucune alarme, ne fait aucun fetch au demarrage meme avec un jeton stocke', async () => {
    const { appels } = charger();
    await new Promise((r) => setTimeout(r, 20));
    expect(appels.alarmes).toBe(0);
    expect(appels.fetch).toBe(0);
  });

  it('refuse le jeton et les declenchements venus d une page', async () => {
    const { appels, externe } = charger();
    const repondre = () => undefined;
    for (const m of [{ type: 'JAY_REACH_LINKEDIN_TOKEN', token: 'x' }, { type: 'TRIGGER_LINKEDIN_POLL' }, { type: 'TRIGGER_LINKEDIN_RELEVE' }]) {
      expect(externe()?.(m, {}, repondre)).not.toBe(true);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(appels.stockage).toBe(0);
    expect(appels.fetch).toBe(0);
  });
});

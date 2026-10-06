/**
 * Le navigateur dédié à LinkedIn (lot 4a) : un Chromium dans son propre conteneur,
 * derrière le proxy résidentiel, piloté en CDP.
 *
 * Ce fichier est le SEUL à toucher `puppeteer-core`, et seulement par un
 * `import()` dynamique dans `ouvrirNavigateur` : le paquet n'est déclaré que
 * dans `apps/worker/package.json`. Il ne doit être atteint que par un
 * `await import('./linkedin/navigateur.js')` depuis le worker, jamais par un
 * import statique, ni depuis `packages/providers` que l'application web importe
 * (la dépendance partirait dans le build Vercel).
 *
 * Aucun secret dans un message d'erreur : une erreur de proxy peut porter
 * l'URL avec ses identifiants. Les erreurs levées ici sont génériques.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normaliserIp } from './ip.js';
import { z } from 'zod';
import type { Sortie } from '@jay-reach/core';

export type Pilote = {
  aller(url: string): Promise<void>;
  url(): Promise<string>;
  saisir(selecteur: string, valeur: string): Promise<void>;
  cliquer(selecteur: string): Promise<void>;
  attendre(selecteur: string, delaiMs: number): Promise<boolean>;
  /**
   * Exécute l'appel DEPUIS LE CONTEXTE DE LA PAGE et rend le statut HTTP (le 999
   * de LinkedIn reste visible). `entetes` sert aux appels Voyager, qui exigent
   * leur protocole et leur décoration ; le jeton CSRF, lui, est ajouté côté page
   * (voir l'implémentation), parce qu'il se lit dans un cookie.
   */
  requete(url: string, entetes?: Record<string, string>): Promise<{ statut: number; corps: string }>;
  fermer(): Promise<void>;
};

const ECHO_IP = 'https://api.ipify.org?format=json';
const PAGE_NEUTRE = 'about:blank';
const DELAI_ACTION_MS = 30_000;

const SchemaEcho = z.object({
  ip: z.string().transform((s, ctx) => {
    const ip = normaliserIp(s);
    if (ip === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ip invalide' });
    return ip ?? z.NEVER;
  }),
});

/** Informatif seulement : chaque champ invalide est écarté, sans faire échouer la relève. */
const SchemaEnrichissement = z.object({
  org: z.string().trim().min(1).max(200).optional().catch(undefined),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((c) => c.toUpperCase())
    .optional()
    .catch(undefined),
});

function lireJson(corps: string): unknown {
  try {
    return JSON.parse(corps);
  } catch {
    return undefined;
  }
}

/**
 * Relève l'IP de sortie telle que LinkedIn la verrait : l'écho est chargé PAR LE
 * NAVIGATEUR, donc par le proxy. Un `fetch` depuis ce processus mesurerait l'IP
 * du VPS, égale à l'IP attendue figée à la première connexion : le contrôle
 * dirait « conforme » à chaque passage sans plus rien contrôler.
 *
 * La relève part d'une page neutre : sur une page LinkedIn, la CSP bloquerait
 * l'appel. Une IP invalide fait échouer la relève (la session n'est pas touchée,
 * voir `verifierSortie`). L'opérateur et le pays sont du meilleur effort.
 */
export async function releverSortie(pilote: Pilote): Promise<Sortie> {
  let ip: string;
  try {
    await pilote.aller(PAGE_NEUTRE);
    const rep = await pilote.requete(ECHO_IP);
    if (rep.statut !== 200) throw new Error('statut');
    ip = SchemaEcho.parse(lireJson(rep.corps)).ip;
  } catch {
    throw new Error("Écho d'IP de sortie inutilisable");
  }

  const sortie: Sortie = { ip };
  try {
    const rep = await pilote.requete(`https://ipinfo.io/${ip}/json`);
    if (rep.statut === 200) {
      const info = SchemaEnrichissement.safeParse(lireJson(rep.corps));
      if (info.success) {
        if (info.data.org) sortie.operateur = info.data.org;
        if (info.data.country) sortie.pays = info.data.country;
      }
    }
  } catch {
    // Meilleur effort : l'IP seule suffit au contrôle.
  }
  return sortie;
}

/**
 * Identité annoncée : Chrome sous Linux, à la version RÉELLE du binaire. Les
 * en-têtes `Sec-CH-UA` doivent dire la même chose que le User-Agent : un
 * `HeadlessChrome` dans l'un seulement serait pire qu'aucun. Les marques restent
 * celles du binaire (Chromium), sans prétendre être Google Chrome.
 * `null` si la version n'est pas lisible : on ne touche alors à rien.
 */
export function identiteNavigateur(versionBrute: string): {
  userAgent: string;
  userAgentMetadata: {
    brands: { brand: string; version: string }[];
    fullVersionList: { brand: string; version: string }[];
    fullVersion: string;
    platform: string;
    platformVersion: string;
    architecture: string;
    bitness: string;
    model: string;
    mobile: boolean;
  };
} | null {
  const m = /(\d+)(\.\d+\.\d+\.\d+)/.exec(versionBrute);
  if (!m) return null;
  const majeure = m[1]!;
  const complete = `${majeure}${m[2]}`;
  return {
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${complete} Safari/537.36`,
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: majeure },
        { brand: 'Not?A_Brand', version: '99' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: complete },
        { brand: 'Not?A_Brand', version: '99.0.0.0' },
      ],
      fullVersion: complete,
      platform: 'Linux',
      platformVersion: '',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false,
    },
  };
}

/**
 * Le serveur DevTools de Chromium refuse toute requête dont l'en-tête Host n'est
 * ni `localhost` ni une IP. Joindre `http://navigateur:9223` échouerait donc :
 * on résout le nom ici et on se connecte à l'IP.
 */
export async function adresseJoignable(
  brute: string,
  resoudre: (hote: string) => Promise<{ address: string; family: number }> = dnsLookup,
): Promise<string> {
  const url = new URL(brute);
  const hote = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hote) !== 0 || hote === 'localhost') return brute.replace(/\/$/, '');
  const { address, family } = await resoudre(hote);
  url.hostname = family === 6 ? `[${address}]` : address;
  return url.toString().replace(/\/$/, '');
}

/**
 * Se connecte au Chromium du conteneur `navigateur` (`LINKEDIN_BROWSER_URL`).
 * Le proxy est posé côté Chromium (`--proxy-server`, sans identifiants : il les
 * refuse dans le drapeau). L'authentification passe par CDP, `page.authenticate`
 * de puppeteer s'appuyant sur `Fetch.continueWithAuth`.
 */
export async function ouvrirNavigateur(): Promise<Pilote> {
  const brute = process.env.LINKEDIN_BROWSER_URL;
  if (!brute) throw new Error('LINKEDIN_BROWSER_URL manquant');
  const user = process.env.LINKEDIN_PROXY_USER;
  const password = process.env.LINKEDIN_PROXY_PASSWORD;

  const { default: puppeteer, TimeoutError } = await import('puppeteer-core');
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: await adresseJoignable(brute),
      defaultViewport: null,
    });
  } catch {
    throw new Error('Connexion au navigateur impossible');
  }
  // Une page par client : deux commandes (ou une commande et la collecte) ne se piétinent pas.
  // Le `about:blank` initial de Chromium reste ouvert et garde le navigateur vivant.
  //
  // TOUT ce qui suit `connect` est enveloppé : un échec de `newPage`, `version`,
  // `setUserAgent` ou `authenticate` laissait la WebSocket CDP et ses écouteurs
  // attachés dans le worker — un processus de longue durée — et parfois un onglet
  // orphelin dans le Chromium qui porte la session LinkedIn, qu'on ne redémarre
  // pas. Des identifiants de proxy mal posés suffisent à le reproduire à chaque
  // collecte.
  let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(DELAI_ACTION_MS);
    const identite = identiteNavigateur(await browser.version());
    if (identite) await page.setUserAgent(identite);
    if (user && password) await page.authenticate({ username: user, password });
  } catch {
    if (page) await page.close().catch(() => undefined);
    try {
      await browser.disconnect();
    } catch {
      // Déjà tombée : il n'y a plus rien à rendre.
    }
    throw new Error('Préparation du navigateur impossible');
  }

  const onglet = page;
  return {
    aller: async (url) => {
      await onglet.goto(url, { waitUntil: 'domcontentloaded' });
    },
    url: async () => onglet.url(),
    saisir: async (selecteur, valeur) => {
      await onglet.waitForSelector(selecteur);
      await onglet.type(selecteur, valeur, { delay: 40 });
    },
    cliquer: async (selecteur) => {
      await onglet.waitForSelector(selecteur);
      await onglet.click(selecteur);
    },
    attendre: async (selecteur, delaiMs) => {
      try {
        await onglet.waitForSelector(selecteur, { timeout: delaiMs });
        return true;
      } catch (e) {
        if (e instanceof TimeoutError) return false;
        throw e;
      }
    },
    // `same-origin` (défaut) : les cookies LinkedIn partent vers LinkedIn, jamais
    // vers l'écho d'IP ; `include` ferait échouer le CORS de l'écho.
    //
    // Le jeton CSRF est ajouté ICI, et seulement pour LinkedIn : il se lit dans
    // le cookie `JSESSIONID`, donc depuis la page. L'API interne le réclame même
    // en lecture — c'est déjà ce que fait l'extension sur son GET de résolution
    // de profil (`apps/extension/linkedin-invite.js`). Sans lui, chaque appel
    // Voyager repartirait en 403, que le collecteur lirait comme un cookie
    // refusé : il bloquerait la session alors qu'elle est valide.
    requete: async (url, entetes) =>
      onglet.evaluate(
        async (u, e) => {
          const headers: Record<string, string> = { ...e };
          if (new URL(u).hostname.endsWith('linkedin.com')) {
            const jeton = /JSESSIONID="?([^;"]+)/.exec(document.cookie);
            if (jeton?.[1]) headers['csrf-token'] = jeton[1];
          }
          const r = await fetch(u, { headers });
          return { statut: r.status, corps: await r.text() };
        },
        url,
        entetes ?? {},
      ),
    // On ferme NOTRE page puis on se détache sans fermer le navigateur : il garde le profil et ses cookies.
    fermer: async () => {
      await onglet.close().catch(() => undefined);
      await browser.disconnect();
    },
  };
}

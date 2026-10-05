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
import { z } from 'zod';
import type { Sortie } from '@jay-reach/core';

export type Pilote = {
  aller(url: string): Promise<void>;
  url(): Promise<string>;
  saisir(selecteur: string, valeur: string): Promise<void>;
  cliquer(selecteur: string): Promise<void>;
  attendre(selecteur: string, delaiMs: number): Promise<boolean>;
  /** Exécute l'appel DEPUIS LE CONTEXTE DE LA PAGE et rend le statut HTTP (le 999 de LinkedIn reste visible). */
  requete(url: string): Promise<{ statut: number; corps: string }>;
  fermer(): Promise<void>;
};

const ECHO_IP = 'https://api.ipify.org?format=json';
const PAGE_NEUTRE = 'about:blank';
const DELAI_ACTION_MS = 30_000;

/**
 * Rend l'IP sous sa graphie canonique, ou `null` si ce n'en est pas une.
 * La comparaison de `verifierSortie` est stricte : « 2001:0DB8::1 » et
 * « 2001:db8::1 » doivent devenir la même chaîne. IPv4 : `isIP` refuse les
 * zéros de tête et les octets hors plage. IPv6 : le parseur d'URL compresse et
 * met en minuscules.
 */
function normaliserIp(brut: string): string | null {
  const ip = brut.trim();
  const famille = isIP(ip);
  if (famille === 4) return ip;
  if (famille === 6) {
    try {
      return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }
  return null;
}

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
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  page.setDefaultTimeout(DELAI_ACTION_MS);
  if (user && password) await page.authenticate({ username: user, password });

  return {
    aller: async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
    url: async () => page.url(),
    saisir: async (selecteur, valeur) => {
      await page.waitForSelector(selecteur);
      await page.type(selecteur, valeur, { delay: 40 });
    },
    cliquer: async (selecteur) => {
      await page.waitForSelector(selecteur);
      await page.click(selecteur);
    },
    attendre: async (selecteur, delaiMs) => {
      try {
        await page.waitForSelector(selecteur, { timeout: delaiMs });
        return true;
      } catch (e) {
        if (e instanceof TimeoutError) return false;
        throw e;
      }
    },
    // `same-origin` (défaut) : les cookies LinkedIn partent vers LinkedIn, jamais
    // vers l'écho d'IP ; `include` ferait échouer le CORS de l'écho.
    requete: async (url) =>
      page.evaluate(async (u) => {
        const r = await fetch(u);
        return { statut: r.status, corps: await r.text() };
      }, url),
    // On se détache sans fermer : le Chromium du conteneur garde le profil et ses cookies.
    fermer: async () => {
      await browser.disconnect();
    },
  };
}

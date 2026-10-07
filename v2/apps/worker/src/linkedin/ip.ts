/**
 * Normalisation des IP et mesure de l'IP du PROCESSUS (sans navigateur).
 *
 * Fichier sans dépendance de pilotage : le CLI l'importe statiquement, alors que
 * `navigateur.ts` (et `puppeteer-core`) ne s'atteint que par `import()`.
 */
import { isIP } from 'node:net';

/**
 * Rend l'IP sous sa graphie canonique, ou `null` si ce n'en est pas une.
 * La comparaison de `verifierSortie` est stricte : « 2001:0DB8::1 » et
 * « 2001:db8::1 » doivent devenir la même chaîne. IPv4 : `isIP` refuse les
 * zéros de tête et les octets hors plage. IPv6 : le parseur d'URL compresse et
 * met en minuscules.
 */
export function normaliserIp(brut: string): string | null {
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

/**
 * IP publique de CE processus, donc du VPS. C'est le seul endroit du lot où un
 * `fetch` Node est légitime : on veut précisément connaître l'IP par laquelle le
 * navigateur ne doit PAS sortir. Lève si elle n'est pas établie (échec franc :
 * sans cette référence on ne fige rien).
 */
export async function ipDuProcessus(): Promise<string> {
  try {
    const rep = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!rep.ok) throw new Error('statut');
    const corps: unknown = await rep.json();
    const brut = typeof corps === 'object' && corps !== null && 'ip' in corps ? corps.ip : null;
    const ip = typeof brut === 'string' ? normaliserIp(brut) : null;
    if (!ip) throw new Error('ip');
    return ip;
  } catch {
    throw new Error('IP du processus worker impossible à établir');
  }
}

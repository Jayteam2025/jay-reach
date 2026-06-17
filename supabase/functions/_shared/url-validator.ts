/**
 * Validation d'URL contre les attaques SSRF.
 *
 * Bloque les IP privées (RFC 1918), link-local, loopback et les endpoints de
 * métadonnées cloud (169.254.169.254, etc.). À utiliser sur toute URL dont
 * l'hôte est influençable par une donnée externe (domaine de société scrapé,
 * import opérateur, redirection suivie côté serveur).
 *
 * Usage :
 *   validateUrlOrThrow(url, { allowHttp: true });           // hôte public uniquement
 *   validateUrlOrThrow(url, { allowedDomains: ['.acme.com'] });
 */

/** Plages d'IP bloquées (RFC 1918, link-local, loopback, métadonnées) */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                     // Loopback
  /^10\./,                      // RFC 1918 classe A
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 classe B
  /^192\.168\./,                // RFC 1918 classe C
  /^169\.254\./,                // Link-local (métadonnées AWS/GCP)
  /^0\./,                       // Réseau courant
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT
  /^::1$/,                      // IPv6 loopback
  /^fd/i,                       // IPv6 ULA
  /^fe80/i,                     // IPv6 link-local
];

/** IP / hôtes de métadonnées cloud connus */
const METADATA_HOSTS = [
  "169.254.169.254", // IMDS AWS/GCP/Azure
  "169.254.170.2",   // ECS task metadata AWS
  "metadata.google.internal",
  "metadata.google",
];

export interface ValidateUrlOptions {
  /** Suffixes de domaines autorisés (ex. ['.acme.com']) */
  allowedDomains?: string[];
  /** Autoriser HTTP en plus de HTTPS ? Défaut : false */
  allowHttp?: boolean;
  /** Préfixe d'erreur personnalisé */
  context?: string;
}

/**
 * Valide une URL contre les attaques SSRF.
 * Lève une erreur si l'URL cible un réseau privé/interne ou un endpoint de métadonnées.
 * Retourne l'URL parsée si elle est sûre.
 *
 * ⚠️ Limite connue : ne résout pas le DNS, donc un domaine public pointant vers une
 * IP privée (DNS rebinding) n'est pas détecté ici. Pour les fetch suivant des
 * redirections, revalider CHAQUE saut (voir followSafeRedirects).
 */
export function validateUrlOrThrow(url: string, options: ValidateUrlOptions = {}): URL {
  const { allowedDomains, allowHttp = false, context = "URL" } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context}: format d'URL invalide`);
  }

  // Protocole
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${context}: protocole non autorisé (${parsed.protocol})`);
  }
  if (!allowHttp && parsed.protocol !== "https:") {
    throw new Error(`${context}: seules les URL HTTPS sont autorisées`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Endpoints de métadonnées
  if (METADATA_HOSTS.includes(hostname)) {
    throw new Error(`${context}: endpoint de métadonnées bloqué`);
  }

  // IP privées / internes
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`${context}: les adresses IP privées/internes ne sont pas autorisées`);
    }
  }

  // localhost et variantes
  if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "[::1]") {
    throw new Error(`${context}: localhost n'est pas autorisé`);
  }

  // Allowlist de domaines (optionnelle)
  if (allowedDomains && allowedDomains.length > 0) {
    const allowed = allowedDomains.some(
      (d) => hostname === d.replace(/^\./, "") || hostname.endsWith(d),
    );
    if (!allowed) {
      throw new Error(`${context}: domaine ${hostname} hors de la liste autorisée`);
    }
  }

  return parsed;
}

/**
 * Effectue un fetch en suivant les redirections MANUELLEMENT, en revalidant chaque
 * saut contre les SSRF (une cible publique peut renvoyer un 302 vers une IP interne).
 *
 * @param initialUrl URL de départ (déjà validée par l'appelant ou non)
 * @param init       options fetch (le champ `redirect` est forcé à "manual")
 * @param opts       validation + nombre max de sauts (défaut 3)
 */
export async function safeFetch(
  initialUrl: string,
  init: RequestInit = {},
  opts: ValidateUrlOptions & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 3, ...validateOpts } = opts;
  let url = validateUrlOrThrow(initialUrl, validateOpts).toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    // 3xx avec Location → revalider la cible avant de suivre
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      const next = new URL(location, url).toString();
      url = validateUrlOrThrow(next, validateOpts).toString();
      continue;
    }
    return res;
  }
  throw new Error(`${validateOpts.context ?? "URL"}: trop de redirections`);
}

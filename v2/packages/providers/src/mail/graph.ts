/**
 * Client Microsoft Graph — lecture directe des reponses (lot 3 bis). SalesBlink
 * reste le transport d'envoi ; sa propre releve detecte les reponses avec des
 * heures de retard (mesure les 10 et 11/09/2026), d'ou la lecture directe de
 * la boite via Graph pour les organisations qui l'activent
 * (`senders.inbox_provider = 'microsoft_graph'`).
 *
 * Authentification : credentials d'application (client_credentials), un
 * tenant Microsoft 365 par organisation, jeton mis en cache memoire jusqu'a
 * expiration moins une marge de securite.
 *
 * Aucun secret, jeton ni URL complete ne doit jamais figurer dans un message
 * d'erreur, un log ou une trace de test : `ErreurGraph` n'expose que `code`,
 * `statut`, et au plus 200 caracteres du corps de reponse.
 */

const BASE_LOGIN = 'https://login.microsoftonline.com';
/** Délai maximal d'un appel HTTP (jeton ou Graph) : un appel qui pend ne doit jamais bloquer un job du worker. */
const DELAI_MS = 30_000;
/** Échappe une valeur littérale OData : l'apostrophe se double. */
function echapperOData(valeur: string): string {
  return valeur.replace(/'/g, "''");
}
const BASE_GRAPH = 'https://graph.microsoft.com/v1.0';
const PREFER_TEXTE = 'outlook.body-content-type="text"';
const LONGUEUR_MAX_ERREUR = 200;
const TAILLE_PAGE_MESSAGES = 50;
const PAGES_MAX_MESSAGES_RECUS = 10;
const TAILLE_PAGE_ENVOYES = 20;
/** Marge de securite avant expiration du jeton mis en cache. */
const MARGE_EXPIRATION_MS = 60_000;
/** Plafond de l'attente sur `Retry-After` (429/503) : jamais plus de 30 s. */
const ATTENTE_MAX_MS = 30_000;

export interface ConfigGraph {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface MessageGraph {
  readonly id: string;
  readonly conversationId: string;
  readonly internetMessageId: string | null;
  readonly subject: string | null;
  readonly from: string | null;
  readonly to: readonly string[];
  readonly receivedDateTime: string;
  readonly sentDateTime: string | null;
  readonly bodyText: string;
  readonly headers: Readonly<Record<string, string>>;
}

export class ErreurGraph extends Error {
  constructor(
    readonly code: 'graph_auth' | 'graph_http' | 'graph_limite',
    readonly statut: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurGraph';
  }
}

// --- Jeton -------------------------------------------------------------

interface JetonEnCache {
  jeton: string;
  expireA: number;
}

/** Cache memoire, une entree par tenant + client (pas de fuite entre organisations). */
const cacheJetons = new Map<string, JetonEnCache>();

function cleCache(cfg: ConfigGraph): string {
  return `${cfg.tenantId}::${cfg.clientId}`;
}

/**
 * Jeton d'application (`client_credentials`), mis en cache memoire jusqu'a
 * expiration moins 60 s. Un appel avec le meme tenant + client dans cette
 * fenetre ne refait pas la requete.
 */
export async function obtenirJeton(cfg: ConfigGraph, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cle = cleCache(cfg);
  const entree = cacheJetons.get(cle);
  if (entree && entree.expireA > Date.now()) return entree.jeton;
  return demanderJeton(cfg, fetchImpl);
}

function invaliderJeton(cfg: ConfigGraph): void {
  cacheJetons.delete(cleCache(cfg));
}

async function demanderJeton(cfg: ConfigGraph, fetchImpl: typeof fetch): Promise<string> {
  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  let reponse: Response;
  try {
    reponse = await fetchImpl(`${BASE_LOGIN}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps.toString(),
    });
  } catch {
    throw new ErreurGraph('graph_auth', null, "Echec de connexion au service d'authentification Microsoft");
  }

  const texteReponse = await reponse.text();
  if (!reponse.ok) {
    const messageErreur = extraireMessageErreur(texteReponse).slice(0, LONGUEUR_MAX_ERREUR);
    throw new ErreurGraph('graph_auth', reponse.status, messageErreur || `Authentification Microsoft Graph refusee (${reponse.status})`);
  }

  let corpsJson: Record<string, unknown>;
  try {
    corpsJson = JSON.parse(texteReponse) as Record<string, unknown>;
  } catch {
    throw new ErreurGraph('graph_auth', reponse.status, "Reponse d'authentification Microsoft Graph invalide (JSON)");
  }

  const jeton = typeof corpsJson.access_token === 'string' ? corpsJson.access_token : null;
  if (!jeton) {
    throw new ErreurGraph('graph_auth', reponse.status, "Reponse d'authentification Microsoft Graph sans jeton");
  }
  const expiresIn = typeof corpsJson.expires_in === 'number' && Number.isFinite(corpsJson.expires_in) ? corpsJson.expires_in : 3600;
  cacheJetons.set(cleCache(cfg), { jeton, expireA: Date.now() + expiresIn * 1000 - MARGE_EXPIRATION_MS });
  return jeton;
}

// --- Appel Graph generique ----------------------------------------------

interface OptionsAppelGraph {
  corps?: unknown;
  preferHeader?: string;
}

interface EtatReessai {
  dejaReessaye401: boolean;
  dejaReessaye429: boolean;
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extraireMessageErreur(texteBrut: string): string {
  try {
    const analyse = JSON.parse(texteBrut) as { error?: { message?: unknown } };
    const message = analyse.error?.message;
    if (typeof message === 'string') return message;
  } catch {
    // corps non-JSON : on retombe sur le texte brut ci-dessous
  }
  return texteBrut;
}

/**
 * Fait l'appel HTTP vers Graph (jeton Bearer inclus), normalise les erreurs en
 * `ErreurGraph`. Sur 401 : invalide le jeton en cache et reessaie une fois.
 * Sur 429/503 : attend `Retry-After` (plafonne a 30 s) et reessaie une fois.
 * Jamais de troisieme tentative — l'appelant recoit `ErreurGraph` sinon.
 */
async function appelerGraph(
  cfg: ConfigGraph,
  methode: 'GET' | 'POST',
  url: string,
  options: OptionsAppelGraph,
  fetchImpl: typeof fetch,
  etat: EtatReessai = { dejaReessaye401: false, dejaReessaye429: false },
): Promise<{ statut: number; corps: unknown }> {
  const jeton = await obtenirJeton(cfg, fetchImpl);
  const entetes: Record<string, string> = {
    Authorization: `Bearer ${jeton}`,
    Accept: 'application/json',
  };
  if (options.preferHeader) entetes.Prefer = options.preferHeader;

  let corpsRequete: BodyInit | undefined;
  if (options.corps !== undefined) {
    entetes['Content-Type'] = 'application/json';
    corpsRequete = JSON.stringify(options.corps);
  }

  let reponse: Response;
  try {
    reponse = await fetchImpl(url, { method: methode, headers: entetes, body: corpsRequete, signal: AbortSignal.timeout(DELAI_MS) });
  } catch {
    throw new ErreurGraph('graph_http', null, 'Echec de connexion a Microsoft Graph');
  }

  if (reponse.status === 401 && !etat.dejaReessaye401) {
    invaliderJeton(cfg);
    return appelerGraph(cfg, methode, url, options, fetchImpl, { ...etat, dejaReessaye401: true });
  }

  if ((reponse.status === 429 || reponse.status === 503) && !etat.dejaReessaye429) {
    const enTete = Number(reponse.headers.get('retry-after'));
    const secondes = Number.isFinite(enTete) && enTete > 0 ? enTete : 1;
    await attendre(Math.min(secondes * 1000, ATTENTE_MAX_MS));
    return appelerGraph(cfg, methode, url, options, fetchImpl, { ...etat, dejaReessaye429: true });
  }

  const texteReponse = await reponse.text();
  if (!reponse.ok) {
    const messageErreur = extraireMessageErreur(texteReponse).slice(0, LONGUEUR_MAX_ERREUR);
    if (reponse.status === 401) {
      throw new ErreurGraph('graph_auth', 401, messageErreur || 'Authentification Microsoft Graph refusee');
    }
    if (reponse.status === 429 || reponse.status === 503) {
      throw new ErreurGraph('graph_limite', reponse.status, messageErreur || 'Limite Microsoft Graph atteinte');
    }
    throw new ErreurGraph('graph_http', reponse.status, messageErreur || `Requete Microsoft Graph refusee (${reponse.status})`);
  }

  if (!texteReponse) return { statut: reponse.status, corps: null };
  try {
    return { statut: reponse.status, corps: JSON.parse(texteReponse) };
  } catch {
    throw new ErreurGraph('graph_http', reponse.status, 'Reponse Microsoft Graph invalide (JSON)');
  }
}

// --- Mapping des messages --------------------------------------------------

function texte(valeur: unknown, repli = ''): string {
  return typeof valeur === 'string' ? valeur : repli;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === 'string' ? valeur : null;
}

function enTableau(valeur: unknown): unknown[] {
  return Array.isArray(valeur) ? valeur : [];
}

/** `{ emailAddress: { address, name } }` -> l'adresse seule (jamais le nom affiche). */
function adresseEmail(valeur: unknown): string | null {
  if (!valeur || typeof valeur !== 'object') return null;
  const emailAddress = (valeur as Record<string, unknown>).emailAddress;
  if (!emailAddress || typeof emailAddress !== 'object') return null;
  return texteOuNull((emailAddress as Record<string, unknown>).address);
}

/** `internetMessageHeaders` (tableau `{ name, value }`) -> objet, noms normalises en minuscules. */
function versEnTetes(valeur: unknown): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const ligne of enTableau(valeur)) {
    if (!ligne || typeof ligne !== 'object') continue;
    const { name, value } = ligne as Record<string, unknown>;
    if (typeof name === 'string' && typeof value === 'string') {
      sortie[name.toLowerCase()] = value;
    }
  }
  return sortie;
}

function versMessageGraph(brut: unknown): MessageGraph {
  const ligne = brut as Record<string, unknown>;
  const to = enTableau(ligne.toRecipients)
    .map(adresseEmail)
    .filter((adresse): adresse is string => adresse !== null);
  const corpsBrut = ligne.body;
  const bodyContent = corpsBrut && typeof corpsBrut === 'object' ? (corpsBrut as Record<string, unknown>).content : undefined;

  return {
    id: texte(ligne.id),
    conversationId: texte(ligne.conversationId),
    internetMessageId: texteOuNull(ligne.internetMessageId),
    subject: texteOuNull(ligne.subject),
    from: adresseEmail(ligne.from),
    to,
    receivedDateTime: texte(ligne.receivedDateTime),
    sentDateTime: texteOuNull(ligne.sentDateTime),
    bodyText: texte(bodyContent),
    headers: versEnTetes(ligne.internetMessageHeaders),
  };
}

// --- Messages ---------------------------------------------------------------

/**
 * Messages recus depuis `depuisIso`, plus recents d'abord. Suit `@odata.nextLink`
 * jusqu'a 10 pages (50 par page, 500 messages au plus par releve).
 */
export async function listerMessagesRecus(
  cfg: ConfigGraph,
  boite: string,
  depuisIso: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MessageGraph[]> {
  const parametres = new URLSearchParams({
    $filter: `receivedDateTime ge ${depuisIso}`,
    $select: 'id,conversationId,internetMessageId,subject,from,toRecipients,receivedDateTime,sentDateTime,body,internetMessageHeaders',
    $top: String(TAILLE_PAGE_MESSAGES),
    $orderby: 'receivedDateTime desc',
  });
  let url = `${BASE_GRAPH}/users/${encodeURIComponent(boite)}/mailFolders/inbox/messages?${parametres.toString()}`;
  const messages: MessageGraph[] = [];

  for (let page = 0; page < PAGES_MAX_MESSAGES_RECUS; page += 1) {
    const { corps } = await appelerGraph(cfg, 'GET', url, { preferHeader: PREFER_TEXTE }, fetchImpl);
    const enveloppe = (corps ?? {}) as Record<string, unknown>;
    messages.push(...enTableau(enveloppe.value).map(versMessageGraph));
    const suite = enveloppe['@odata.nextLink'];
    if (typeof suite !== 'string') break;
    url = suite;
  }
  return messages;
}

/** Messages envoyes dans une conversation donnee (rapprochement des relances). */
export async function listerEnvoyesDansConversation(
  cfg: ConfigGraph,
  boite: string,
  conversationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MessageGraph[]> {
  const parametres = new URLSearchParams({
    $filter: `conversationId eq '${echapperOData(conversationId)}'`,
    $select: 'id,conversationId,internetMessageId,subject,toRecipients,sentDateTime',
    $top: String(TAILLE_PAGE_ENVOYES),
  });
  const url = `${BASE_GRAPH}/users/${encodeURIComponent(boite)}/mailFolders/sentitems/messages?${parametres.toString()}`;
  const { corps } = await appelerGraph(cfg, 'GET', url, {}, fetchImpl);
  const enveloppe = (corps ?? {}) as Record<string, unknown>;
  return enTableau(enveloppe.value).map(versMessageGraph);
}

/** Repond dans le fil d'un message recu. 202 attendu (accepte, traitement asynchrone cote Graph). */
export async function repondreDansLaBoite(
  cfg: ConfigGraph,
  boite: string,
  messageId: string,
  corpsHtml: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `${BASE_GRAPH}/users/${encodeURIComponent(boite)}/messages/${encodeURIComponent(messageId)}/reply`;
  await appelerGraph(
    cfg,
    'POST',
    url,
    {
      corps: { message: { body: { contentType: 'HTML', content: corpsHtml } } },
      preferHeader: 'outlook.timezone="Europe/Paris"',
    },
    fetchImpl,
  );
}

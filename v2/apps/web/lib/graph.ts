/**
 * Client Microsoft Graph minimal côté web — uniquement la réponse à un message
 * reçu, pour la zone de réponse de la Réception (lot 3 bis, tâche 3).
 *
 * Ne réimporte PAS `@jay-reach/providers/mail` (le client complet du worker,
 * `repondreDansLaBoite`) : ce sous-chemin résout vers `dist/`, absent tant que
 * le paquet n'a pas été construit — ce que Vercel ne fait pas pour les paquets
 * internes lors du build de `apps/web` (`apps/web/vercel.json` ne construit
 * que `@jay-reach/web`, pas `packages/*`). L'importer casserait le déploiement,
 * même indirectement via `@jay-reach/worker` (qui dépend lui aussi de
 * `@jay-reach/providers`) — même raison déjà documentée dans `salesblink.ts`
 * pour `listerBoitesSalesBlink`.
 *
 * Aucun jeton ni secret ne doit jamais fuiter dans une erreur : `ErreurGraphWeb`
 * ne porte qu'un code générique, jamais le corps de réponse Microsoft.
 */
import { getPool } from './db';

const BASE_LOGIN = 'https://login.microsoftonline.com';
const BASE_GRAPH = 'https://graph.microsoft.com/v1.0';
/** Appel déclenché par un clic opérateur (pas un job de fond) : délai court mais suffisant pour un aller-retour Microsoft. */
const TIMEOUT_MS = 15_000;

export interface ConfigGraphWeb {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export class ErreurGraphWeb extends Error {
  constructor(
    readonly code: 'graph_auth' | 'graph_http',
    message: string,
  ) {
    super(message);
    this.name = 'ErreurGraphWeb';
  }
}

/**
 * Résout la configuration Microsoft Graph de l'organisation : `tenant_id` /
 * `client_id` depuis la config JSON du coffre (non secrets), `client_secret`
 * déchiffré via `app.get_credential` — mêmes champs que le provider
 * `microsoft_graph` du catalogue (`packages/providers/src/catalog.ts`),
 * variables d'environnement en repli, même ordre que `resolveSalesblinkKey`.
 */
export async function resolveGraphConfig(organizationId: string): Promise<ConfigGraphWeb | null> {
  const pool = getPool();

  let config: Record<string, string> | null = null;
  try {
    const res = await pool.query<{ config: Record<string, string> | null }>(
      'select config from credentials where organization_id = $1 and provider_id = $2',
      [organizationId, 'microsoft_graph'],
    );
    config = res.rows[0]?.config ?? null;
  } catch {
    // Coffre injoignable : on retombe sur l'environnement ci-dessous.
  }

  const tenantId = config?.tenant_id || process.env.MS_GRAPH_TENANT_ID || null;
  const clientId = config?.client_id || process.env.MS_GRAPH_CLIENT_ID || null;

  let clientSecret: string | null = null;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    try {
      const res = await pool.query<{ secret: string | null }>(
        'select app.get_credential($1, $2, $3) as secret',
        [organizationId, 'microsoft_graph', encryptionKey],
      );
      clientSecret = res.rows[0]?.secret ?? null;
    } catch {
      clientSecret = null;
    }
  }
  clientSecret = clientSecret || process.env.MS_GRAPH_CLIENT_SECRET || null;

  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

async function obtenirJetonWeb(cfg: ConfigGraphWeb): Promise<string> {
  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_LOGIN}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ErreurGraphWeb('graph_auth', "Échec de connexion au service d'authentification Microsoft");
  }
  if (!reponse.ok) {
    throw new ErreurGraphWeb('graph_auth', `Authentification Microsoft Graph refusée (${reponse.status})`);
  }

  let corpsJson: { access_token?: unknown };
  try {
    corpsJson = (await reponse.json()) as { access_token?: unknown };
  } catch {
    throw new ErreurGraphWeb('graph_auth', "Réponse d'authentification Microsoft Graph invalide");
  }
  if (typeof corpsJson.access_token !== 'string') {
    throw new ErreurGraphWeb('graph_auth', "Réponse d'authentification Microsoft Graph sans jeton");
  }
  return corpsJson.access_token;
}

/** Répond dans le fil d'un message reçu, dans une boîte Microsoft 365 donnée. */
export async function repondreDansLaBoiteWeb(
  cfg: ConfigGraphWeb,
  boite: string,
  messageId: string,
  corpsHtml: string,
): Promise<void> {
  const jeton = await obtenirJetonWeb(cfg);
  const url = `${BASE_GRAPH}/users/${encodeURIComponent(boite)}/messages/${encodeURIComponent(messageId)}/reply`;

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { body: { contentType: 'HTML', content: corpsHtml } } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ErreurGraphWeb('graph_http', 'Échec de connexion à Microsoft Graph');
  }
  if (!reponse.ok) {
    throw new ErreurGraphWeb('graph_http', `Requête Microsoft Graph refusée (${reponse.status})`);
  }
}

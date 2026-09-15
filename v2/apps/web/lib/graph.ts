/**
 * Résolution de la configuration Microsoft Graph d'une organisation, côté web
 * (lot 3 bis, tâche 3 — zone de réponse de la Réception).
 *
 * L'appel réseau lui-même passe par `repondreDansLaBoite`
 * (`@jay-reach/providers/mail`) : ce paquet compile déjà dans `apps/web`
 * (`actions/providers.ts`, `settings/providers/page.tsx` importent
 * `@jay-reach/providers`) — les `paths` de `tsconfig.base.json` font pointer
 * `@jay-reach/providers/mail` vers `packages/providers/src/mail/index.ts`,
 * et Next suit ces chemins pour sa résolution webpack, indépendamment de
 * `package.json#exports` (qui pointerait sinon vers un `dist/` non construit
 * au déploiement de `apps/web`).
 */
import type { ConfigGraph } from '@jay-reach/providers/mail';
import { getPool } from './db';

/**
 * `tenant_id` / `client_id` depuis la config JSON du coffre (non secrets),
 * `client_secret` déchiffré via `app.get_credential` — mêmes champs que le
 * provider `microsoft_graph` du catalogue (`packages/providers/src/catalog.ts`),
 * variables d'environnement en repli, même ordre que `resolveSalesblinkKey`.
 */
export async function resolveGraphConfig(organizationId: string): Promise<ConfigGraph | null> {
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

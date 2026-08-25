/**
 * Pont de résolution des credentials (ticket dédié) : au moment d'exécuter une
 * action, le worker résout les credentials d'un provider pour une organisation.
 *
 * Deux sources, dans cet ordre (comme le legacy) :
 *  1. le coffre chiffré — secret déchiffré via `app.get_credential` + `config` jsonb ;
 *  2. un repli sur les variables d'environnement (`fallbackEnv` du manifeste),
 *     pour un fonctionnement mono-org sans passer par l'écran Fournisseurs.
 *
 * Les secrets ne voyagent donc JAMAIS dans le payload d'un job pg-boss : ils
 * sont déchiffrés à l'exécution et restent en mémoire du worker.
 */
import type { Pool } from 'pg';
import { getProviderEntry } from '@jay-reach/providers';
import { getCredentialSecret, getCredentialConfig } from './db.js';

export interface ResolveOptions {
  /** Clé de chiffrement (ENCRYPTION_KEY). Absente → coffre ignoré, repli env seul. */
  readonly encryptionKey?: string | undefined;
}

/**
 * Retourne un Record `nom de champ -> valeur` prêt pour le connecteur, ou `null`
 * si un champ requis manque (provider non configuré) — le job est alors ignoré
 * proprement plutôt que de partir en erreur.
 */
export async function resolveProviderCredentials(
  pool: Pool,
  organizationId: string,
  providerId: string,
  opts: ResolveOptions = {},
): Promise<Record<string, string> | null> {
  const entry = getProviderEntry(providerId);
  if (!entry) {
    throw new Error(`Provider inconnu : ${providerId}`);
  }

  const config = await getCredentialConfig(pool, organizationId, providerId);
  let secret: string | null = null;
  if (opts.encryptionKey) {
    secret = await getCredentialSecret(pool, organizationId, providerId, opts.encryptionKey);
  }

  const resolved: Record<string, string> = {};
  for (const field of entry.fields) {
    let value: string | undefined = field.secret ? (secret ?? undefined) : config?.[field.name];
    if ((value === undefined || value === '') && field.fallbackEnv) {
      value = process.env[field.fallbackEnv];
    }
    if (value === undefined || value === '') {
      if (field.required) {
        return null;
      }
      continue;
    }
    resolved[field.name] = value;
  }
  return resolved;
}

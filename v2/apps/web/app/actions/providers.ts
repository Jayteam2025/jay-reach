'use server';

import { getProviderEntry } from '@jay-reach/providers';
import { requireEnv } from '../../lib/env';
import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type ProviderActionResult = { ok: true } | { ok: false; error: string };

/**
 * Enregistre le secret d'un provider, chiffré côté base (pgcrypto). La clé de
 * chiffrement vient de l'environnement serveur ; le secret ne repart jamais
 * vers le navigateur. Exige le rôle admin sur l'organisation.
 */
export async function setProviderCredential(
  organizationId: string,
  providerId: string,
  secret: string,
  config: Record<string, unknown> = {},
): Promise<ProviderActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (!getProviderEntry(providerId)) {
    return { ok: false, error: `Provider inconnu : ${providerId}` };
  }

  const service = createServiceClient();
  const { error } = await service.rpc('set_provider_credential', {
    p_org: organizationId,
    p_provider: providerId,
    p_secret: secret,
    p_key: requireEnv('ENCRYPTION_KEY'),
    p_config: config,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Test de connexion. Le test réel par provider arrive avec chaque
 * implémentation (T20 Smartlead, T22 LinkedIn…). Ici on valide que le
 * provider est connu.
 */
export async function testProviderConnection(
  _organizationId: string,
  providerId: string,
): Promise<ProviderActionResult> {
  if (!getProviderEntry(providerId)) {
    return { ok: false, error: `Provider inconnu : ${providerId}` };
  }
  return { ok: true };
}

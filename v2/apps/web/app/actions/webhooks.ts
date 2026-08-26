'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type WebhookSecretResult = { ok: true; secret: string } | { ok: false; error: string };

/**
 * Génère (ou régénère) le secret du webhook Smartlead de l'organisation et le
 * range dans `credentials.config.webhook_secret` (sans toucher à la clé API).
 * Le secret sert de token dans l'URL du webhook, vérifié en temps constant par
 * le endpoint `/api/webhooks/smartlead`. Admin requis.
 */
export async function regenerateSmartleadWebhookSecret(organizationId: string): Promise<WebhookSecretResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const secret = randomBytes(24).toString('hex');
  const service = createServiceClient();
  const { error } = await service.rpc('merge_provider_config', {
    p_org: organizationId,
    p_provider: 'smartlead',
    p_config: { webhook_secret: secret },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/smartlead');
  return { ok: true, secret };
}

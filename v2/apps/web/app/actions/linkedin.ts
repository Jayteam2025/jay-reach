'use server';

import { randomBytes } from 'node:crypto';
import { requireRole, getUser } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type LinkedInMode = 'auto' | 'hybrid' | 'manual';
export type TokenResult = { ok: true; token: string } | { ok: false; error: string };
export type SettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Génère (ou régénère) un jeton d'extension pour l'organisation. Désactive les
 * jetons précédents de l'utilisateur pour cette org. Exige le rôle admin.
 * Le jeton est renvoyé une seule fois : la page le transmet à l'extension.
 */
export async function generateExtensionToken(organizationId: string): Promise<TokenResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const user = await getUser();
  if (!user) {
    return { ok: false, error: 'Non authentifié.' };
  }

  const token = `lkx_${randomBytes(24).toString('base64url')}`;
  const service = createServiceClient();

  await service
    .from('extension_tokens')
    .update({ is_active: false })
    .eq('organization_id', organizationId)
    .eq('user_id', user.id);

  const { error } = await service.from('extension_tokens').insert({
    token,
    organization_id: organizationId,
    user_id: user.id,
    label: 'Extension LinkedIn',
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, token };
}

/** Enregistre le curseur (mode + volume/jour). Exige le rôle admin. */
export async function saveLinkedInSettings(
  organizationId: string,
  mode: LinkedInMode,
  dailyCap: number,
): Promise<SettingsResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const cap = Math.max(0, Math.min(200, Math.round(dailyCap)));
  const service = createServiceClient();
  const { error } = await service
    .from('linkedin_settings')
    .upsert(
      { organization_id: organizationId, mode, daily_cap: cap, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

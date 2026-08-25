'use server';

import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type SignalActionResult = { ok: true } | { ok: false; error: string };

/**
 * Valide ou écarte un signal (transition de `signals.status`). Exige le rôle
 * operator sur l'organisation. « Valider » → `qualified` ; « Écarter » →
 * `discarded` avec un motif stable (`manual`) affiché en clair sur l'écran.
 */
export async function setSignalStatus(
  organizationId: string,
  signalId: string,
  decision: 'validate' | 'discard',
): Promise<SignalActionResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }

  const service = createServiceClient();
  const patch =
    decision === 'validate'
      ? { status: 'qualified', discard_reason: null }
      : { status: 'discarded', discard_reason: 'manual' };

  const { error } = await service
    .from('signals')
    .update(patch)
    .eq('id', signalId)
    .eq('organization_id', organizationId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

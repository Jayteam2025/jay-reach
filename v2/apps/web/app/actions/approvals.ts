'use server';

import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type ApprovalResult = { ok: true } | { ok: false; error: string };

/**
 * Valide ou rejette une action en attente d'approbation (file d'attente humaine).
 * « Valider » → `approved` (partira à l'envoi) ; « Rejeter » → `cancelled`.
 * Exige le rôle operator. N'agit que sur les actions en `pending_approval`.
 */
export async function setActionApproval(
  organizationId: string,
  actionId: string,
  decision: 'approve' | 'reject',
): Promise<ApprovalResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const svc = createServiceClient();
  const now = new Date().toISOString();
  const patch =
    decision === 'approve'
      ? { status: 'approved', approved_at: now }
      : { status: 'cancelled' };
  const { error } = await svc
    .from('actions')
    .update(patch)
    .eq('id', actionId)
    .eq('organization_id', organizationId)
    .eq('status', 'pending_approval');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

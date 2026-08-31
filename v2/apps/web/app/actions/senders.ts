'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type SenderActionResult = { ok: true } | { ok: false; error: string };

/**
 * Champs d'un expéditeur qu'un opérateur peut régler depuis l'application.
 *
 * L'identité (adresse email, identifiant LinkedIn) n'en fait pas partie : elle
 * vient du compte branché chez le provider. La changer ici ne changerait rien à
 * ce qui part réellement, et laisserait croire le contraire.
 */
export interface SenderInput {
  readonly displayName: string;
  /** Plafonds d'envoi. `null` = aucun plafond propre à cet expéditeur. */
  readonly dailyQuota: number | null;
  readonly hourlyQuota: number | null;
  readonly isActive: boolean;
}

function normaliserQuota(valeur: number | null): number | null | 'invalide' {
  if (valeur === null) {
    return null;
  }
  if (!Number.isInteger(valeur) || valeur < 0) {
    return 'invalide';
  }
  return valeur;
}

/** Met à jour un expéditeur de l'organisation (droit administrateur requis). */
export async function updateSender(
  organizationId: string,
  senderId: string,
  input: SenderInput,
): Promise<SenderActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const quotidien = normaliserQuota(input.dailyQuota);
  const horaire = normaliserQuota(input.hourlyQuota);
  if (quotidien === 'invalide' || horaire === 'invalide') {
    return { ok: false, error: 'Les plafonds doivent être des entiers positifs.' };
  }
  if (quotidien !== null && horaire !== null && horaire > quotidien) {
    // Un plafond horaire au-dessus du quotidien ne veut rien dire : le
    // séquenceur retient le plus contraignant, donc l'horaire serait ignoré
    // sans que personne ne s'en aperçoive.
    return { ok: false, error: 'Le plafond horaire ne peut pas dépasser le plafond quotidien.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('senders')
    .update({
      display_name: input.displayName.trim() || null,
      daily_quota: quotidien,
      hourly_quota: horaire,
      is_active: input.isActive,
    })
    .eq('id', senderId)
    .eq('organization_id', organizationId);

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/senders');
  return { ok: true };
}

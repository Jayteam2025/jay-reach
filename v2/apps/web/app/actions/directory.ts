'use server';

import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type AddResult = { ok: true } | { ok: false; error: string };

/**
 * Ajoute une entreprise de l'annuaire à la base (table `accounts`), en résolu
 * par SIREN. Exige le rôle operator. Dédup par (organisation, SIREN).
 */
export async function addAccountFromDirectory(
  organizationId: string,
  company: { siren: string; name: string; naf: string | null; city: string | null; postalCode: string | null },
): Promise<AddResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const svc = createServiceClient();
  const { error } = await svc.from('accounts').upsert(
    {
      organization_id: organizationId,
      name: company.name,
      siren: company.siren,
      naf_code: company.naf,
      city: company.city,
      postal_code: company.postalCode,
      resolution_status: 'resolved',
    },
    { onConflict: 'organization_id,siren' },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

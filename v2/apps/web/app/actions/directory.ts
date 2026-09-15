'use server';

import { revalidatePath } from 'next/cache';

import { requireRole } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';
import { ajouterDepuisAnnuaire, ErreurEntree, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

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
  revalidatePath('/annuaire');
  revalidatePath('/prospects');
  return { ok: true };
}

/** Demande d'ajout en masse, telle que l'écran la dépose. */
export interface BulkImportParams {
  readonly q: string;
  readonly naf: string;
  readonly department: string;
  readonly effectif: string;
  /** `page` : seulement la page affichée. `all` : tout le jeu de résultats. */
  readonly scope: 'page' | 'all';
  /** Page affichée, quand la portée est `page`. */
  readonly page: number;
}

export type BulkResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Dépose une demande d'ajout en masse. Le worker la relève et la traite.
 *
 * On ne le fait pas ici : « tous les résultats » peut représenter quatre cents
 * appels à l'API publique, ce qui ne tient pas dans une requête HTTP. L'écran
 * suit l'avancement en relisant la ligne créée.
 */
export async function startBulkImport(
  organizationId: string,
  params: BulkImportParams,
): Promise<BulkResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const svc = createServiceClient();

  // Un seul import en cours par organisation : deux imports concurrents
  // taperaient l'API publique en double et rendraient la progression illisible.
  const { data: enCours } = await svc
    .from('directory_bulk_imports')
    .select('id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'running'])
    .limit(1);
  if ((enCours ?? []).length > 0) {
    return { ok: false, error: 'Un ajout est déjà en cours.' };
  }

  const { data, error } = await svc
    .from('directory_bulk_imports')
    .insert({ organization_id: organizationId, params })
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/annuaire');
  return { ok: true, id: (data as { id: string }).id };
}

/** Demande l'arrêt d'un ajout en cours. Le worker le relit entre deux pages. */
export async function cancelBulkImport(organizationId: string, id: string): Promise<AddResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const svc = createServiceClient();
  const { error } = await svc
    .from('directory_bulk_imports')
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'running']);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/annuaire');
  return { ok: true };
}

/** État d'un ajout en masse, pour la barre de progression. */
export interface BulkStatus {
  readonly status: string;
  readonly total: number;
  readonly processed: number;
  readonly added: number;
  readonly existing: number;
  readonly error: string | null;
}

export async function getBulkImport(organizationId: string, id: string): Promise<BulkStatus | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('directory_bulk_imports')
    .select('status, total, processed, added, existing, error')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return (data as BulkStatus | null) ?? null;
}

// ---------------------------------------------------------------------------
// Source « Annuaire d'entreprises » de l'onglet Sources d'une campagne
// (tâche 11, lot 2). Façade fine sur `ajouterDepuisAnnuaire`
// (`packages/core/src/fonctions/sources.ts`) : la recherche reste celle
// ci-dessus (`searchCompanies`, `apps/web/lib/directory.ts`, une API publique
// sans état) — cette action ne fait que PERSISTER les entreprises déjà
// cochées à l'écran. R41 : verse des entreprises dans la campagne, jamais de
// contact.
// ---------------------------------------------------------------------------

export interface EntrepriseAnnuaireInput {
  readonly siren: string;
  readonly name: string;
  readonly naf: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
}

export type ResultatAjouterDepuisAnnuaire =
  | { ok: true; entreprisesRetenues: number; dejaConnues: number }
  | { ok: false; error: string; issues?: string[] };

export async function actionAjouterDepuisAnnuaire(
  campagneId: string,
  entreprises: EntrepriseAnnuaireInput[],
): Promise<ResultatAjouterDepuisAnnuaire> {
  try {
    const ctx = await contexteCourant();
    const r = await ajouterDepuisAnnuaire(ctx, { campagneId, entreprises });
    revalidatePath(`/campaigns/${campagneId}/sources`);
    revalidatePath(`/campaigns/${campagneId}`);
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'Droit opérateur requis.' };
    if (err instanceof ErreurEntree) {
      const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
      const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
        (m): m is string => typeof m === 'string',
      );
      return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
    }
    if (err instanceof ErreurIntrouvable) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

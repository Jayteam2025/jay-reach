'use server';

import { revalidatePath } from 'next/cache';
import { approuverEnvoi, rejeterEnvoi, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ApprovalResult = { ok: true } | { ok: false; error: string };

/** Jamais d'exception non attrapée hors d'une Server Action (même garantie que `campagne-cycle.ts`). */
function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit opérateur requis.';
  if (err instanceof ErreurIntrouvable) return 'Cet envoi n’est plus en attente d’approbation.';
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

/**
 * Valide ou rejette une action en attente d'approbation (file d'attente humaine).
 * « Valider » → `approved` (partira à l'envoi) ; « Rejeter » → `cancelled`.
 * Exige le rôle operator. N'agit que sur les actions en `pending_approval`.
 *
 * Façade fine sur `approuverEnvoi`/`rejeterEnvoi`
 * (`packages/core/src/fonctions/file-du-jour.ts`, tâche 10), reprise par le
 * tiroir « Relire avant envoi » de la file du jour (`TiroirRelecture.tsx`,
 * nouveau design) — l'écran `/approvals` qui l'appelait à l'origine est
 * retiré depuis la tâche 24.
 */
export async function setActionApproval(
  organizationId: string,
  actionId: string,
  decision: 'approve' | 'reject',
): Promise<ApprovalResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    if (decision === 'approve') {
      await approuverEnvoi(ctx, { actionId });
    } else {
      await rejeterEnvoi(ctx, { actionId });
    }
    revalidatePath('/campaigns');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

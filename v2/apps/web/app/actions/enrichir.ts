'use server';

import { revalidatePath } from 'next/cache';
import {
  chercherEmail,
  ErreurEnrichissementImpossible,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type EnrichirResult = { ok: true; message: string } | { ok: false; error: string };

/** Même traduction que `messageDErreur` (`app/actions/contacts.ts`) — `chercherEmail` exige `operator`. */
function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit opérateur requis.';
  if (err instanceof ErreurEntree) return 'Entrée invalide.';
  if (err instanceof ErreurIntrouvable) return err.message;
  if (err instanceof ErreurEnrichissementImpossible) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

/**
 * Façade sur `chercherEmail` (`packages/core/src/fonctions/contacts.ts`) pour
 * le bouton « Chercher l'email » des onglets Contacts et File du jour d'une
 * campagne, qui ne connaissent qu'un `signalId` (pas de fiche contact
 * ouverte, contrairement à `actionChercherEmailContact`) : on résout le
 * contact rattaché à ce signal, puis on délègue.
 *
 * Avant ce correctif (revue finale du lot 2, I4), cette action refaisait dans
 * l'app les six étapes de `chercherEmail` (choix de persona, décompte du
 * crédit, mise en file) avec un choix de persona différent — deux clics sur
 * le même compte depuis deux écrans pouvaient enfiler deux personas
 * distinctes et payer deux fois le crédit.
 */
export async function enrichirMaintenant(organizationId: string, signalId: string): Promise<EnrichirResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }

    const contactRes = await ctx.ex.query<{ id: string }>(
      `select id from contacts /* jr:enrichir_maintenant_contact */ where source_signal_id = $1 and organization_id = $2`,
      [signalId, organizationId],
    );
    const contact = contactRes.rows[0];
    if (!contact) {
      return { ok: false, error: 'Aucun contact rattaché à ce signal : rien à enrichir.' };
    }

    await chercherEmail(ctx, { contactId: contact.id });
    revalidatePath('/contacts');
    return { ok: true, message: 'Recherche d’email lancée. Le contact apparaîtra dans Contacts d’ici quelques minutes.' };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

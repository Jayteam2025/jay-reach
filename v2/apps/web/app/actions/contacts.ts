'use server';

/**
 * Façades fines sur `packages/core/src/fonctions/contacts.ts` (tâche 17) :
 * ajouter une note, marquer « ne plus contacter », chercher l'email — pour le
 * tiroir « fiche contact ». La lecture (`lireFiche`) n'a pas de façade ici :
 * elle est appelée directement, côté serveur, par la page qui ouvre le tiroir
 * (même motif que `apercuEnvoi` dans `campaigns/[id]/queue/page.tsx`).
 */
import { revalidatePath } from 'next/cache';
import {
  ajouterNote,
  chercherEmail,
  nePlusContacter,
  ErreurEnrichissementImpossible,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatFiche = { ok: true } | { ok: false; error: string };
export type ResultatNote = { ok: true; id: string } | { ok: false; error: string };

function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit opérateur requis.';
  if (err instanceof ErreurEntree) return 'Entrée invalide.';
  if (err instanceof ErreurIntrouvable) return err.message;
  if (err instanceof ErreurEnrichissementImpossible) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionAjouterNote(contactId: string, texte: string): Promise<ResultatNote> {
  try {
    const ctx = await contexteCourant();
    const { id } = await ajouterNote(ctx, { contactId, texte });
    revalidatePath('/contacts');
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionNePlusContacter(contactId: string): Promise<ResultatFiche> {
  try {
    const ctx = await contexteCourant();
    await nePlusContacter(ctx, { contactId });
    revalidatePath('/contacts');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionChercherEmailContact(contactId: string): Promise<ResultatFiche> {
  try {
    const ctx = await contexteCourant();
    await chercherEmail(ctx, { contactId });
    revalidatePath('/contacts');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

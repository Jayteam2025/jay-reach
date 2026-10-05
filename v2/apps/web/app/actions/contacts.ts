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
  ajouterAListe,
  ajouterNote,
  ajouterSuppression,
  chercherEmail,
  nePlusContacter,
  ErreurEnrichissementImpossible,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille, revaliderLayoutCampagne } from '../../lib/revalidation-layouts';

/**
 * La fiche (tiroir) s'ouvre sur `/contacts` ET sur l'onglet Contacts d'une
 * campagne : les deux pages sont revalidées, faute de quoi l'action ne
 * rafraîchirait que l'une des deux (le rechargement complet qu'elle
 * remplace masquait ce défaut).
 */
function revaliderFiche(): void {
  revalidatePath('/contacts');
  revalidatePath('/campaigns/[id]/contacts', 'page');
}

export type ResultatFiche = { ok: true } | { ok: false; error: string };
export type ResultatNote = { ok: true; id: string } | { ok: false; error: string };

/** `role` : celui EXIGÉ par la fonction appelée (`exiger(ctx, ...)`), pour un message d'erreur qui nomme le bon droit manquant — `ajouterAListe` exige admin, les autres façades de ce fichier operator. */
function messageDErreur(err: unknown, role: 'opérateur' | 'administrateur' = 'opérateur'): string {
  if (err instanceof ForbiddenError) return `Droit ${role} requis.`;
  if (err instanceof ErreurEntree) return 'Entrée invalide.';
  if (err instanceof ErreurIntrouvable) return err.message;
  if (err instanceof ErreurEnrichissementImpossible) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionAjouterNote(contactId: string, texte: string): Promise<ResultatNote> {
  try {
    const ctx = await contexteCourant();
    const { id } = await ajouterNote(ctx, { contactId, texte });
    revaliderFiche();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionNePlusContacter(contactId: string): Promise<ResultatFiche> {
  try {
    const ctx = await contexteCourant();
    await nePlusContacter(ctx, { contactId });
    revaliderFiche();
    // Arrête les inscriptions vivantes de TOUTES les campagnes : envois planifiés
    // (badge File du jour, jauge « en file ») modifiés.
    revaliderLayoutCampagne('[id]');
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionChercherEmailContact(contactId: string): Promise<ResultatFiche> {
  try {
    const ctx = await contexteCourant();
    await chercherEmail(ctx, { contactId });
    revaliderFiche();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export type ResultatAjout = { ok: true } | { ok: false; error: string };
export type ResultatAjoutListe = { ok: true; id: string } | { ok: false; error: string };

export async function actionAjouterSuppression(
  scope: 'email' | 'domain' | 'linkedin',
  value: string,
  reason?: string,
): Promise<ResultatAjout> {
  try {
    const ctx = await contexteCourant();
    await ajouterSuppression(ctx, { scope, value, reason });
    revalidatePath('/contacts');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionAjouterAListe(domaine: string): Promise<ResultatAjoutListe> {
  try {
    const ctx = await contexteCourant();
    const { id } = await ajouterAListe(ctx, { domaine });
    revalidatePath('/contacts');
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: messageDErreur(err, 'administrateur') };
  }
}

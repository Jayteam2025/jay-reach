'use server';

/**
 * Façades fines sur `packages/core/src/fonctions/fournisseurs.ts` (tâche 21) :
 * enregistrer une clé, tester une connexion — pour l'écran Réglages ›
 * Fournisseurs. La lecture (`listerFournisseurs`) n'a pas de façade ici : elle
 * est appelée directement, côté serveur, par `settings/providers/page.tsx`
 * (même motif que `contacts.ts`/`lireFiche`).
 *
 * Remplace les anciennes `setProviderCredential`/`testProviderConnection`
 * (lot 3 bis) : elles n'avaient plus qu'un seul appelant, `provider-form.tsx`,
 * supprimé avec l'ancien écran (tâche 21, brief : « remplace-la par la
 * nouvelle »). `setProviderCredential` acceptait en outre un secret VIDE et
 * l'envoyait quand même à la base — un opérateur modifiant un seul réglage
 * sans retaper sa clé l'aurait écrasée par une chaîne vide ; `enregistrerCle`
 * (schéma `schemaEnregistrerCle`, `packages/core`) l'exige non vide.
 */
import { revalidatePath } from 'next/cache';
import {
  enregistrerCle,
  ErreurEntree,
  ErreurFournisseurNonConfigure,
  ForbiddenError,
  modifierConfigFournisseur,
  testerFournisseur,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatFournisseur = { ok: true } | { ok: false; error: string };
export type ResultatTestFournisseur = { ok: true; testeeLe: string } | { ok: false; error: string };

function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit administrateur requis.';
  if (err instanceof ErreurEntree) return 'Entrée invalide.';
  if (err instanceof ErreurFournisseurNonConfigure) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionEnregistrerCle(
  providerId: string,
  secret: string,
  config?: Record<string, string>,
): Promise<ResultatFournisseur> {
  try {
    const ctx = await contexteCourant();
    await enregistrerCle(ctx, { providerId, secret, config });
    revalidatePath('/settings/providers');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

/**
 * Modifie un ou plusieurs champs non secrets (sync_interval_min, model_smart…)
 * sans passer par `enregistrerCle` — relecture tâche 21, point 2 : un
 * opérateur qui ne change que l'intervalle de relève de Microsoft Graph ne
 * doit pas devoir retaper le secret du client.
 */
export async function actionModifierConfigFournisseur(providerId: string, config: Record<string, string>): Promise<ResultatFournisseur> {
  try {
    const ctx = await contexteCourant();
    await modifierConfigFournisseur(ctx, { providerId, config });
    revalidatePath('/settings/providers');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

export async function actionTesterFournisseur(providerId: string): Promise<ResultatTestFournisseur> {
  try {
    const ctx = await contexteCourant();
    const { testeeLe } = await testerFournisseur(ctx, { providerId });
    revalidatePath('/settings/providers');
    return { ok: true, testeeLe };
  } catch (err) {
    return { ok: false, error: messageDErreur(err) };
  }
}

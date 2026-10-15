'use server';

/**
 * Façade fine sur `packages/core/src/fonctions/posts.ts` pour l'onglet Posts d'une campagne.
 * Elle ne valide rien : la validation Zod et le contrôle de rôle vivent dans les fonctions
 * métier, que le futur serveur MCP appellera à l'identique. Aucune action n'efface quoi que ce
 * soit, et il n'y en a pas pour le faire.
 */
import { revalidatePath } from 'next/cache';
import {
  corrigerSujetDePost,
  rejeterPost,
  reouvrirPost,
  validerPost,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatPost = { ok: true } | { ok: false; error: string; issues?: string[] };

/**
 * Traduit une erreur des fonctions de `posts.ts` en résultat de façade, jamais une exception
 * qui ferait tomber la Server Action (même convention que `actions/step-message.ts`).
 */
function resultatDErreur(err: unknown): { ok: false; error: string; issues?: string[] } {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  if (err instanceof ErreurEntree) {
    const details = err.details as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const issues = [
      ...(details.formErrors ?? []),
      ...Object.values(details.fieldErrors ?? {}).flat(),
    ].filter((m): m is string => typeof m === 'string');
    return { ok: false, error: issues[0] ?? 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

function revalider(campagneId: string) {
  // Le layout porte le compteur de l'onglet : il se relit avec la page.
  revalidatePath(`/campaigns/${campagneId}`, 'layout');
}

export async function actionValiderPost(campagneId: string, postId: string): Promise<ResultatPost> {
  try {
    const ctx = await contexteCourant();
    await validerPost(ctx, { postId });
    revalider(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/**
 * Valide plusieurs posts, un par un, et s'arrête au premier refus : ceux déjà validés le
 * restent (chacun est un geste complet), le message dit où ça s'est arrêté.
 */
export async function actionValiderPosts(campagneId: string, postIds: string[]): Promise<ResultatPost> {
  try {
    const ctx = await contexteCourant();
    for (const postId of postIds) await validerPost(ctx, { postId });
    revalider(campagneId);
    return { ok: true };
  } catch (err) {
    revalider(campagneId);
    return resultatDErreur(err);
  }
}

export async function actionCorrigerSujet(campagneId: string, postId: string, sujet: string): Promise<ResultatPost> {
  try {
    const ctx = await contexteCourant();
    await corrigerSujetDePost(ctx, { postId, sujet });
    revalider(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionRejeterPost(campagneId: string, postId: string): Promise<ResultatPost> {
  try {
    const ctx = await contexteCourant();
    await rejeterPost(ctx, { postId });
    revalider(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionReouvrirPost(campagneId: string, postId: string): Promise<ResultatPost> {
  try {
    const ctx = await contexteCourant();
    await reouvrirPost(ctx, { postId });
    revalider(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

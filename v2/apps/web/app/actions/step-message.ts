'use server';

import { revalidatePath } from 'next/cache';
import {
  enregistrerVersionModele,
  verserDansBibliotheque,
  lireCampagnePourEtape,
  enregistrerEtape,
  supprimerEtape,
  envoyerTest,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type StepMessageResult =
  | { ok: true; templateParentId: string }
  | { ok: false; error: string; issues?: string[] };
export type SimpleResult = { ok: true } | { ok: false; error: string; issues?: string[] };
export type EnregistrerEtapeResult = { ok: true; etapeId: string } | { ok: false; error: string; issues?: string[] };

/**
 * Traduit une erreur des fonctions de `packages/core/src/fonctions/sequence.ts`
 * en résultat de façade — jamais une exception qui ferait tomber la Server
 * Action (même convention que `apps/web/app/actions/sources.ts`).
 */
function resultatDErreur(err: unknown): { ok: false; error: string; issues?: string[] } {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit administrateur requis.' };
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
    return { ok: false, error: 'Entrée invalide.', issues: issues.length > 0 ? issues : undefined };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/** Message écrit directement dans une étape de séquence. */
export interface StepMessageInput {
  /** Objet : email seulement. LinkedIn et courrier n'en ont pas. */
  readonly subject: string;
  readonly body: string;
  readonly channel: 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';
  readonly locale: string;
  /** Nature de la campagne, pour savoir quelles variables sont disponibles. */
  readonly nature: 'signal' | 'list';
  /** Modèle existant à réécrire, s'il y en a un. */
  readonly templateParentId: string | null;
}

/**
 * Enregistre le message d'une étape (canal quelconque). Façade fine sur
 * `enregistrerVersionModele` (`packages/core/src/fonctions/sequence.ts`,
 * origin `step`) : la validation des variables, le versionnage (nouvelle
 * version plutôt qu'écrasement — des envois déjà partis pointent sur la
 * version en cours) et l'écriture vivent désormais dans core, appelables à
 * l'identique par le futur serveur MCP.
 *
 * Historique : `saveStepMessage` n'a aujourd'hui aucun appelant dans
 * l'écran (l'onglet Séquence de la tâche 12 appelle `actionEnregistrerEtape`
 * ci-dessous, qui écrit modèle ET étape ensemble) — conservée telle quelle
 * pour ne pas casser un futur appelant de cette façade.
 */
export async function saveStepMessage(
  organizationId: string,
  campaignId: string,
  input: StepMessageInput,
): Promise<StepMessageResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    if (!input.body.trim()) {
      return { ok: false, error: 'Le message est vide.' };
    }
    if (input.channel === 'email' && !input.subject.trim()) {
      return { ok: false, error: 'Un email a besoin d’un objet.' };
    }

    const campagne = await lireCampagnePourEtape(ctx, campaignId);
    const { id } = await enregistrerVersionModele(ctx, {
      familyId: input.templateParentId,
      nom: campagne.name,
      canal: input.channel,
      locale: input.locale,
      sujet: input.channel === 'email' ? input.subject.trim() : null,
      corps: input.body.trim(),
      nature: input.nature,
      origin: 'step',
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, templateParentId: input.templateParentId ?? id };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/**
 * Verse dans la bibliothèque un message écrit dans une étape (retour 9.3).
 * Façade fine sur `verserDansBibliotheque`.
 */
export async function promoteStepMessage(
  organizationId: string,
  campaignId: string,
  templateParentId: string,
  name: string,
): Promise<SimpleResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    const nom = name.trim();
    if (!nom) {
      return { ok: false, error: 'Donnez un nom au modèle.' };
    }
    await verserDansBibliotheque(ctx, { campagneId: campaignId, templateParentId, nom });
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath('/settings/templates');
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

// ---------------------------------------------------------------------------
// Onglet Séquence (tâche 12) : tiroir d'étape — écrit modèle ET étape ensemble.
// ---------------------------------------------------------------------------

function revaliderOngletSequence(campagneId: string): void {
  revalidatePath(`/campaigns/${campagneId}/sequence`);
  revalidatePath(`/campaigns/${campagneId}`);
}

/** Crée (`etapeId` absent) ou réécrit une étape email de la séquence. */
export async function actionEnregistrerEtape(campagneId: string, input: unknown): Promise<EnregistrerEtapeResult> {
  try {
    const ctx = await contexteCourant();
    const entree = typeof input === 'object' && input !== null ? { ...input, campagneId } : { campagneId };
    const { etapeId } = await enregistrerEtape(ctx, entree);
    revaliderOngletSequence(campagneId);
    return { ok: true, etapeId };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionSupprimerEtape(campagneId: string, etapeId: string): Promise<SimpleResult> {
  try {
    const ctx = await contexteCourant();
    await supprimerEtape(ctx, { campagneId, etapeId });
    revaliderOngletSequence(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/** « M'envoyer un test » (tiroir d'étape) : n'appelle jamais SalesBlink directement, le moteur envoie par le chemin normal. */
export async function actionEnvoyerTest(campagneId: string, etapeId: string): Promise<SimpleResult> {
  try {
    const ctx = await contexteCourant();
    await envoyerTest(ctx, { etapeId });
    revaliderOngletSequence(campagneId);
    return { ok: true };
  } catch (err) {
    return resultatDErreur(err);
  }
}

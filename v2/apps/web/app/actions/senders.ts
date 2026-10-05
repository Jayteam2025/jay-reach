'use server';

import { revalidatePath } from 'next/cache';
import {
  boitesSalesBlinkNonReliees as boitesSalesBlinkNonRelieesCoeur,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  listerBoites as listerBoitesCoeur,
  modifierBoite as modifierBoiteCoeur,
  relierBoite as relierBoiteCoeur,
  type Boite,
  type BoiteSalesBlinkDistante,
} from '@jay-reach/core';
import { activerLectureBoite, santeBoite } from '@jay-reach/providers/outreach';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille } from '../../lib/revalidation-layouts';
import { listerBoitesSalesBlink, resolveSalesblinkKey } from '../../lib/salesblink';

// ---------------------------------------------------------------------------
// Réglages › Expéditeurs (tâche 20) — façades minces sur
// `packages/core/src/fonctions/expediteurs.ts` (spec « une fonction, deux
// façades »). Ce fichier construit le `Contexte` et les vrais transports
// (client HTTP SalesBlink, résolution de clé) ; tout le reste — validation,
// autorisation, requêtes — vit dans le cœur.
// ---------------------------------------------------------------------------

export type ResultatExpediteurs<T = void> = { ok: true; valeur: T } | { ok: false; error: string };

function resultatDErreur<T>(err: unknown): ResultatExpediteurs<T> {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (err instanceof ErreurEntree) {
    return { ok: false, error: 'Entrée invalide.' };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/**
 * Lit la santé SalesBlink d'une boîte, avec la clé de l'organisation
 * courante. Renvoyée telle quelle à `listerBoites`, qui l'appelle sous un
 * délai de 3 s : une clé absente ou un appel en échec y comptent comme
 * « indisponible », jamais comme une erreur qui remonterait à l'écran.
 */
function creerLecteurSante(organizationId: string) {
  return async (providerRef: string) => {
    const cle = await resolveSalesblinkKey(organizationId);
    if (!cle) throw new Error('SalesBlink non configuré');
    const sante = await santeBoite(providerRef, cle);
    return { connectee: sante.connectee, score: sante.sante };
  };
}

/** Boîtes email de l'organisation courante (Réglages › Expéditeurs). */
export async function listerBoitesExpediteurs(): Promise<ResultatExpediteurs<Boite[]>> {
  try {
    const ctx = await contexteCourant();
    const boites = await listerBoitesCoeur(ctx, creerLecteurSante(ctx.organisationId));
    return { ok: true, valeur: boites };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/** Modifie les plafonds, la fenêtre d'envoi et la lecture directe des réponses d'une boîte. */
export async function actionModifierBoite(entree: unknown): Promise<ResultatExpediteurs> {
  try {
    const ctx = await contexteCourant();
    await modifierBoiteCoeur(ctx, entree);
    revalidatePath('/settings/senders');
    // Plafond de la jauge de la barre latérale = somme des quotas des boîtes email actives.
    revaliderCoquille();
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreur<void>(err);
  }
}

/** Boîtes du workspace SalesBlink pas encore reliées, pour le sélecteur « Relier une boîte ». */
export async function actionBoitesSalesBlinkNonReliees(): Promise<ResultatExpediteurs<BoiteSalesBlinkDistante[]>> {
  try {
    const ctx = await contexteCourant();
    const distantes = await boitesSalesBlinkNonRelieesCoeur(ctx, async () => {
      const resultat = await listerBoitesSalesBlink(ctx.organisationId);
      if (!resultat.ok) {
        throw new Error(resultat.error === 'no_key' ? 'Clé SalesBlink absente (onglet Fournisseurs).' : 'SalesBlink injoignable.');
      }
      return resultat.boites.map((b) => ({ providerRef: b.id, email: b.email, nom: b.nom }));
    });
    return { ok: true, valeur: distantes };
  } catch (err) {
    return resultatDErreur<BoiteSalesBlinkDistante[]>(err);
  }
}

/** Relie une boîte SalesBlink : crée l'expéditeur puis active la lecture des réponses côté SalesBlink. */
export async function actionRelierBoite(entree: unknown): Promise<ResultatExpediteurs<{ id: string }>> {
  try {
    const ctx = await contexteCourant();
    const resultat = await relierBoiteCoeur(ctx, entree, async (providerRef) => {
      const cle = await resolveSalesblinkKey(ctx.organisationId);
      if (!cle) throw new Error("SalesBlink n'est pas configuré pour cette organisation.");
      await activerLectureBoite(providerRef, cle);
    });
    revalidatePath('/settings/senders');
    // Plafond de la jauge de la barre latérale = somme des quotas des boîtes email actives.
    revaliderCoquille();
    return { ok: true, valeur: resultat };
  } catch (err) {
    return resultatDErreur<{ id: string }>(err);
  }
}

'use server';

/**
 * Façade fine sur `packages/core/src/fonctions/linkedin-connexion.ts` pour Réglages › LinkedIn
 * (lot 5) : `contexteCourant()` + mapping d'erreurs. L'autorisation (`admin`) et la validation Zod
 * vivent dans la fonction du cœur, jamais ici.
 *
 * Le mot de passe et le code ne sont ni journalisés ni renvoyés : toute erreur inattendue devient un
 * message générique (le texte d'une exception pourrait porter une requête, donc un secret).
 */
import {
  annulerConnexion,
  demanderConnexion,
  demanderDeconnexion,
  ErreurAucunCodeAttendu,
  ErreurConnexionEnCours,
  ErreurEntree,
  ErreurFormulaireFerme,
  ErreurTransmissionConnexion,
  ForbiddenError,
  lireDemandeEnCours,
  repondreDefi,
  type Demande,
} from '@jay-reach/core';
import { revalidatePath } from 'next/cache';
import { contexteCourant } from '../../lib/contexte';

/**
 * Les deux écrans que l'état d'une connexion change : Réglages › LinkedIn (la carte de session) et
 * Aujourd'hui (la ligne « votre compte LinkedIn » de la liste de démarrage). On revalide côté
 * serveur plutôt que de faire rafraîchir le client — règle du dépôt, `rafraichissement.test.ts`.
 */
function revaliderEcransLinkedin(): void {
  revalidatePath('/settings/linkedin');
  revalidatePath('/settings/senders');
  revalidatePath('/');
}

export type ResultatConnexion<T = void> =
  | { ok: true; valeur: T }
  | { ok: false; error: string; code: 'en_cours' | 'ferme' | 'droit' | 'entree' | 'aucun_code' | 'transmission' | 'inconnue'; rouvreA?: string };

function resultatDErreur<T>(err: unknown): ResultatConnexion<T> {
  if (err instanceof ErreurConnexionEnCours) return { ok: false, code: 'en_cours', error: err.message };
  if (err instanceof ErreurFormulaireFerme) {
    return { ok: false, code: 'ferme', error: err.message, rouvreA: err.rouvreA.toISOString() };
  }
  if (err instanceof ForbiddenError) return { ok: false, code: 'droit', error: 'Droit administrateur requis.' };
  if (err instanceof ErreurEntree) return { ok: false, code: 'entree', error: 'Entrée invalide.' };
  if (err instanceof ErreurAucunCodeAttendu) return { ok: false, code: 'aucun_code', error: err.message };
  if (err instanceof ErreurTransmissionConnexion) return { ok: false, code: 'transmission', error: err.message };
  return { ok: false, code: 'inconnue', error: 'Erreur inconnue.' };
}

/** Lance la connexion : identifiant et mot de passe voyagent dans le corps de l'action (HTTPS), jamais dans une URL. */
export async function actionDemanderConnexion(entree: unknown): Promise<ResultatConnexion<{ demandeId: string }>> {
  try {
    const valeur = await demanderConnexion(await contexteCourant(), entree);
    revaliderEcransLinkedin();
    return { ok: true, valeur };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/** Sondage de l'écran (toutes les 2 s) : tranche aussi le cas du worker absent. */
export async function actionLireDemandeEnCours(): Promise<ResultatConnexion<Demande | null>> {
  try {
    const demande = await lireDemandeEnCours(await contexteCourant());
    // Close ou disparue : la session a changé d'état côté serveur, les écrans doivent le montrer.
    if (demande === null || demande.statut === 'reussi' || demande.statut === 'echec') {
      revaliderEcransLinkedin();
    }
    return { ok: true, valeur: demande };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionRepondreDefi(demandeId: unknown, code: unknown): Promise<ResultatConnexion> {
  try {
    await repondreDefi(await contexteCourant(), String(demandeId), String(code));
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionAnnulerConnexion(demandeId: unknown): Promise<ResultatConnexion> {
  try {
    await annulerConnexion(await contexteCourant(), String(demandeId));
    revaliderEcransLinkedin();
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreur(err);
  }
}

export async function actionDemanderDeconnexion(): Promise<ResultatConnexion> {
  try {
    await demanderDeconnexion(await contexteCourant());
    revaliderEcransLinkedin();
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreur(err);
  }
}

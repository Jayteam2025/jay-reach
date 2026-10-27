'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { contexteCourant } from '../../lib/contexte';
import { DUREE_FERMETURE_DEMARRAGE_SECONDES, nomCookieDemarrageFerme } from '../../lib/demarrage-fermeture';

/**
 * Ferme le guide de démarrage de l'écran Aujourd'hui pour l'utilisateur courant, sur ce navigateur.
 * Aucune écriture en base : c'est une préférence d'affichage, pas une donnée de l'organisation.
 */
export async function fermerDemarrage(): Promise<void> {
  const ctx = await contexteCourant();
  // Sans utilisateur identifié, il n'y a personne à qui mémoriser quoi que ce soit.
  if (ctx.utilisateurId === null) return;
  const jar = await cookies();
  jar.set(nomCookieDemarrageFerme(ctx.utilisateurId), '1', {
    maxAge: DUREE_FERMETURE_DEMARRAGE_SECONDES,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  revalidatePath('/');
}

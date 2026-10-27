/**
 * La fermeture du guide de démarrage de l'écran Aujourd'hui, mémorisée PAR UTILISATEUR.
 *
 * Un cookie plutôt qu'un `localStorage` : l'écran est rendu côté serveur, qui doit savoir si le
 * guide est fermé (et si l'alerte qu'il masque doit revenir) AVANT d'envoyer la page — un
 * stockage navigateur ferait clignoter le bloc à chaque affichage. Le nom porte l'identifiant de
 * l'utilisateur : deux personnes sur le même navigateur ne se ferment pas le guide l'une à l'autre.
 */
import { cookies } from 'next/headers';

/** Un an : le guide ne revient pas tant que l'opérateur ne change pas de navigateur. */
export const DUREE_FERMETURE_DEMARRAGE_SECONDES = 60 * 60 * 24 * 365;

export function nomCookieDemarrageFerme(utilisateurId: string): string {
  return `jr-demarrage-ferme-${utilisateurId}`;
}

export async function demarrageFerme(utilisateurId: string | null): Promise<boolean> {
  if (utilisateurId === null) return false;
  const jar = await cookies();
  return jar.get(nomCookieDemarrageFerme(utilisateurId))?.value === '1';
}

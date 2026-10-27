/**
 * Ce que l'onglet Posts sait d'une ligne, SANS rien de client.
 *
 * Ces types et `ligneValidable` vivaient dans `TablePosts.tsx`, marqué `'use client'`. Or la page
 * (composant serveur) appelle `ligneValidable` pour compter le lot : Next.js remplace tout export
 * d'un module client par une référence, et l'appeler côté serveur lève « Attempted to call
 * ligneValidable() from the server but ligneValidable is on the client » (digest 2889543129,
 * toute campagne avec au moins un post à relire). Vitest ne tient pas cette frontière : seul
 * `lib/frontiere-client-serveur.test.ts` la garde.
 */
import type { ChampAccroche } from '@jay-reach/core';

/**
 * Un morceau de la phrase. `manquant` porte un libellé DÉJÀ composé (« date indisponible ») :
 * comme le reste de cet écran, le texte arrive écrit du serveur — c'est lui qui a la langue.
 */
export type MorceauEcran = { texte: string } | { champ: ChampAccroche } | { manquant: string };

export interface LignePostEcran {
  id: string;
  /** `null` : l'auteur n'a pas pu être lu, l'écran écrit « Auteur inconnu » et laisse l'écrire. */
  auteur: string | null;
  /** Déjà composé (« publié le 12/10 »). */
  publie: string;
  url: string;
  sujet: string | null;
  /** La phrase déjà résolue, découpée autour des champs que l'opérateur écrit lui-même. */
  morceaux: MorceauEcran[];
  etat: 'pending' | 'approved' | 'rejected';
  etatLibelle: string;
  /** Déjà composé (« jusqu'à 47 personnes attendent »), `null` quand la campagne ne nomme aucun post. */
  attente: string | null;
  /** `null` quand la campagne ne nomme aucun post : l'épargne de purge ne s'applique pas, rien à promettre. */
  echeance: string | null;
  tonEcheance: 'loin' | 'bientot' | 'urgent';
  etiquetteSujet: string;
  etiquetteAuteur: string;
}

/** Les champs que la phrase de CETTE campagne rend éditables : ceux-là seuls partiront. */
export function champsDeLaLigne(ligne: LignePostEcran): ChampAccroche[] {
  return ligne.morceaux.flatMap((m) => ('champ' in m ? [m.champ] : []));
}

/**
 * Un post se valide en lot quand il attend sa relecture ET que tous les champs que la campagne
 * écrit sont remplis. « Tous », et pas « le sujet » : une campagne qui nomme l'auteur sans le
 * sujet se valide sur l'auteur, et le serveur refuserait l'inverse.
 *
 * Une variable que la campagne écrit, qui manque, et que l'opérateur ne peut PAS écrire (la date
 * de publication) exclut la ligne du lot : le serveur la refuserait, « Tout valider » s'arrête au
 * premier refus, et rien de ce que l'opérateur peut faire ne la débloquerait. Son bouton
 * « Valider » à elle reste actif, lui : c'est la seule façon de lire pourquoi.
 */
export function ligneValidable(ligne: LignePostEcran): boolean {
  if (ligne.etat !== 'pending') return false;
  if (ligne.morceaux.some((m) => 'manquant' in m)) return false;
  return champsDeLaLigne(ligne).every((c) => ((c === 'auteur' ? ligne.auteur : ligne.sujet) ?? '').trim() !== '');
}

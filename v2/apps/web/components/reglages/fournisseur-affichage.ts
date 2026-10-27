/**
 * Logique d'affichage pure de la carte d'un fournisseur (Réglages › Fournisseurs), séparée de la
 * page pour rester testable sans contexte next-intl — même convention que `boite-affichage.ts`.
 */
import type { FournisseurVue } from '@jay-reach/core';
import type { PuceTon } from '../ui';

/**
 * Fournisseurs dont l'application se passe. Apify lit les OFFRES D'EMPLOI publiées sur LinkedIn
 * (`apifyScraper`, `packages/providers/src/signals/apify.ts`, branché sur `sources.discover` dans
 * le worker) : un connecteur d'offres au même titre qu'Adzuna ou France Travail, qu'aucune source
 * proposée à l'écran n'utilise aujourd'hui. Le canal LinkedIn (collecte des réactions, envoi des
 * messages) passe, lui, par la session du serveur de l'écran LinkedIn et n'appelle jamais Apify :
 * le dire « nécessaire au canal LinkedIn » et « À renseigner » sur un canal pourtant prêt était faux.
 */
export const FOURNISSEURS_FACULTATIFS: ReadonlySet<string> = new Set(['apify']);

export type CleEtatFournisseur = 'facultatif' | 'aRenseigner' | 'echec' | 'connecte' | 'cleValide';

/** Clé de traduction (sous `reglages.fournisseurs.etat`) et ton de la puce d'état d'un fournisseur. */
export function etatFournisseur(
  f: Pick<FournisseurVue, 'providerId' | 'categorie' | 'cle'>,
): { ton: PuceTon; cle: CleEtatFournisseur } {
  if (!f.cle.presente) {
    return { ton: 'gris', cle: FOURNISSEURS_FACULTATIFS.has(f.providerId) ? 'facultatif' : 'aRenseigner' };
  }
  if (f.cle.statut === 'echec') return { ton: 'attention', cle: 'echec' };
  const connecte = f.categorie === 'envoi' || f.categorie === 'reception';
  return { ton: 'bon', cle: connecte ? 'connecte' : 'cleValide' };
}

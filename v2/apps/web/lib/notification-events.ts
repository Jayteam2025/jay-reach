/**
 * Catalogue des événements de la carte « Mes notifications » (Réglages ›
 * Compte, tâche 23). Fichier neutre (ni `'use server'` ni `'use client'`) :
 * `app/actions/notifications.ts` ne peut exporter que des fonctions async
 * (règle Next.js des fichiers `'use server'`) — cette liste, valeur
 * exportée, vit donc à part et est importée des deux côtés (façade serveur,
 * composant client).
 */
export const EVENEMENTS_NOTIFICATION = [
  'reply_received',
  'send_failed',
  'sender_disconnected',
  'quota_reached',
  'daily_digest',
] as const;

export type EvenementNotification = (typeof EVENEMENTS_NOTIFICATION)[number];

export interface PreferenceNotification {
  event: EvenementNotification;
  actif: boolean;
}

/** Réglage d'usine : tout actif sauf le résumé du soir (moins urgent, sur demande — maquette `reglages-compte.html`). */
export const DEFAUT_ACTIF_NOTIFICATION: Record<EvenementNotification, boolean> = {
  reply_received: true,
  send_failed: true,
  sender_disconnected: true,
  quota_reached: true,
  daily_digest: false,
};

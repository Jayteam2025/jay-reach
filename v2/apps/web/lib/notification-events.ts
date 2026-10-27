/**
 * Catalogue des événements de la carte « Mes notifications » (Réglages ›
 * Compte, tâche 23). Fichier neutre (ni `'use server'` ni `'use client'`) :
 * `app/actions/notifications.ts` ne peut exporter que des fonctions async
 * (règle Next.js des fichiers `'use server'`) — cette liste, valeur
 * exportée, vit donc à part et est importée des deux côtés (façade serveur,
 * composant client).
 *
 * `CATALOGUE_EVENEMENTS_NOTIFICATION` reprend les cinq lignes de la maquette
 * `reglages-compte.html`, mais un événement n'entre dans
 * `EVENEMENTS_NOTIFICATION_ACTIFS` (la liste réellement proposée à l'écran)
 * QUE lorsque son producteur existe déjà dans le code — sinon un opérateur
 * activerait un interrupteur qui ne déclenche jamais rien. Producteurs
 * existants au 16/10 (tous via `notifier`, `packages/core/src/inbox/record-reply.ts`) :
 * `contact.replied` (`notifyReply`, relève LinkedIn et courriel),
 * `linkedin.session_blocked` (`linkedin-session.ts`), `linkedin.collecte_arretee`
 * (`collecte-linkedin.ts`) et `linkedin.reponse_echouee` (`reponse-manuelle.ts`).
 * `sender.disconnected` (`releve-salesblink.ts`) est émis aussi mais ne figure
 * pas au catalogue (son nom diffère de `sender_disconnected`).
 * `send_failed`/`sender_disconnected`/`quota_reached`/`daily_digest` restent
 * dans le catalogue pour mémoire ; en sortir un vers la liste active se fait
 * en un geste dès que son producteur existe (et sa traduction dans
 * `fr.json`/`en.json`/`nl.json`, retirée ici faute d'écran qui les référence
 * — le garde-fou `clesMortesSous`, R84, les signalerait sinon comme mortes).
 */
export const CATALOGUE_EVENEMENTS_NOTIFICATION = [
  'contact.replied',
  'linkedin.session_blocked',
  'linkedin.collecte_arretee',
  'linkedin.reponse_echouee',
  'send_failed',
  'sender_disconnected',
  'quota_reached',
  'daily_digest',
] as const;

export type EvenementNotification = (typeof CATALOGUE_EVENEMENTS_NOTIFICATION)[number];

/** Sous-ensemble du catalogue réellement proposé à l'écran aujourd'hui — voir le commentaire d'en-tête. */
export const EVENEMENTS_NOTIFICATION_ACTIFS = [
  'contact.replied',
  'linkedin.session_blocked',
  'linkedin.collecte_arretee',
  'linkedin.reponse_echouee',
] as const satisfies readonly EvenementNotification[];

export type EvenementNotificationActif = (typeof EVENEMENTS_NOTIFICATION_ACTIFS)[number];

export interface PreferenceNotification {
  event: EvenementNotificationActif;
  actif: boolean;
}

/** Réglage d'usine : tout actif (aucun des quatre événements « à venir » n'a encore de digest du soir à tempérer). */
export const DEFAUT_ACTIF_NOTIFICATION: Record<EvenementNotificationActif, boolean> = {
  'contact.replied': true,
  'linkedin.session_blocked': true,
  'linkedin.collecte_arretee': true,
  'linkedin.reponse_echouee': true,
};

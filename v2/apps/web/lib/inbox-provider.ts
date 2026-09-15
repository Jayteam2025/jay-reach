/**
 * Valeur admise pour `senders.inbox_provider` : la lecture directe des réponses
 * n'existe que pour Microsoft Graph. Hors d'un fichier `'use server'` : Next n'y
 * tolère que des fonctions asynchrones exportées, et cette fonction est pure.
 */
export function normaliserInboxProvider(valeur: unknown): 'microsoft_graph' | null | 'invalide' {
  if (valeur === null || valeur === undefined || valeur === '') {
    return null;
  }
  if (valeur === 'microsoft_graph') {
    return 'microsoft_graph';
  }
  return 'invalide';
}

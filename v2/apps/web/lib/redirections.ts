/**
 * Table des anciennes routes retirées (tâche 24) vers leur équivalent dans le
 * nouveau design (cinq entrées : Aujourd'hui, Campagnes, Contacts, Réception,
 * Réglages). Consommée par `next.config.ts` (redirections permanentes, 308)
 * et vérifiée par `redirections.test.ts` : c'est la seule source de vérité,
 * `next.config.ts` ne doit rien redéclarer en dur.
 *
 * Les paramètres d'onglet (`onglet=entreprises`, `onglet=clients`) sont ceux
 * que `apps/web/app/(app)/contacts/page.tsx` (tâche 18) lit réellement — pas
 * `onglet=exclusions`, qui n'existe pas côté page : l'onglet « Clients » y
 * couvre à la fois les clients et les exclusions (`TableExclusions`).
 */
export interface Redirection {
  readonly source: string;
  readonly destination: string;
}

export const REDIRECTIONS: readonly Redirection[] = [
  { source: '/signals', destination: '/campaigns' },
  { source: '/prospects', destination: '/contacts' },
  { source: '/annuaire', destination: '/contacts?onglet=entreprises' },
  { source: '/approvals', destination: '/campaigns' },
  { source: '/import', destination: '/contacts' },
  { source: '/settings/sources', destination: '/campaigns' },
  { source: '/settings/templates', destination: '/settings/messages' },
  { source: '/settings/customers', destination: '/contacts?onglet=clients' },
  { source: '/settings/jobs', destination: '/settings/engine' },
];

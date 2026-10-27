/**
 * Les huit entrées de la sous-navigation de Réglages, dans l'ordre de mise en route : on branche
 * d'abord les canaux (LinkedIn, puis les boîtes email), on dit à qui l'on parle et ce qu'on lui
 * écrit (Personas, Messages), puis on borne (Plafonds), on branche les services (Fournisseurs),
 * et seulement après on regarde le moteur et le compte.
 *
 * Hors de `NavReglages.tsx` (composant client) pour rester importable par un composant serveur et
 * par un test sans traverser la frontière client/serveur.
 */
export interface EntreeNavReglages {
  readonly cle: string;
  readonly href: string;
}

export const ENTREES_NAV_REGLAGES: readonly EntreeNavReglages[] = [
  { cle: 'linkedin', href: '/settings/linkedin' },
  { cle: 'senders', href: '/settings/senders' },
  { cle: 'personas', href: '/settings/personas' },
  { cle: 'messages', href: '/settings/messages' },
  { cle: 'limits', href: '/settings/limits' },
  { cle: 'providers', href: '/settings/providers' },
  { cle: 'engine', href: '/settings/engine' },
  { cle: 'account', href: '/settings/account' },
];

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Sous-navigation des huit pages de Réglages (tâche 20, maquettes
 * `reglages-*.html`). Les sept ont désormais leur route neuve (Fournisseurs,
 * Personas, Messages, Expéditeurs, Moteur — tâche 23 ; Plafonds et Compte —
 * tâche 24, une fois leurs pages livrées) : plus d'entrée en lecture seule.
 */
interface EntreeNavReglages {
  readonly cle: string;
  readonly href: string;
}

const ENTREES: EntreeNavReglages[] = [
  { cle: 'senders', href: '/settings/senders' },
  { cle: 'limits', href: '/settings/limits' },
  { cle: 'linkedin', href: '/settings/linkedin' },
  { cle: 'providers', href: '/settings/providers' },
  { cle: 'personas', href: '/settings/personas' },
  { cle: 'messages', href: '/settings/messages' },
  { cle: 'engine', href: '/settings/engine' },
  { cle: 'account', href: '/settings/account' },
];

export function NavReglages() {
  const pathname = usePathname();
  const t = useTranslations('reglages.nav');

  return (
    <nav className="jr-nav-reglages">
      {ENTREES.map((entree) => (
        <Link
          key={entree.cle}
          href={entree.href}
          className={pathname.startsWith(entree.href) ? 'actif' : undefined}
          aria-current={pathname.startsWith(entree.href) ? 'page' : undefined}
        >
          {t(entree.cle)}
        </Link>
      ))}
    </nav>
  );
}

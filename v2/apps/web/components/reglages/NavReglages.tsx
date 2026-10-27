'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ENTREES_NAV_REGLAGES } from './nav-reglages';

/**
 * Sous-navigation des huit pages de Réglages (tâche 20, maquettes
 * `reglages-*.html`). L'ordre des entrées vit dans `nav-reglages.ts`.
 */
export function NavReglages() {
  const pathname = usePathname();
  const t = useTranslations('reglages.nav');

  return (
    <nav className="jr-nav-reglages">
      {ENTREES_NAV_REGLAGES.map((entree) => (
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

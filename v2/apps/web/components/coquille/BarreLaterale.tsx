'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface BarreLateraleProps {
  /** Nombre de fils à traiter, pour le badge de l'entrée Réception. */
  aTraiterTotal: number;
}

type Entree = { href: string; cle: string; icone: ReactNode };

// Icônes reprises telles quelles de la maquette (`_internal/maquettes/lot2/aujourdhui.html`) :
// `svg` nu, sans props — la taille et le trait viennent de la règle globale
// `.jr-app svg` de composants.css, pas d'un composant Icon partagé.
const ENTREES: Entree[] = [
  {
    href: '/',
    cle: 'today',
    icone: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    href: '/campaigns',
    cle: 'campaigns',
    icone: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 11l18-8-7 18-2-7-9-3z" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    cle: 'contacts',
    icone: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M17 14c2.2 0 4 1.8 4 4" />
      </svg>
    ),
  },
  {
    href: '/inbox',
    cle: 'inbox',
    icone: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 13h5l2 3h4l2-3h5" />
      </svg>
    ),
  },
  {
    href: '/settings',
    cle: 'settings',
    icone: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
      </svg>
    ),
  },
];

/** Une entrée est active sur sa route et ses sous-routes ; « Aujourd'hui » (`/`) seulement sur la racine. */
function estActif(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function BarreLaterale({ aTraiterTotal }: BarreLateraleProps) {
  const t = useTranslations('coquille.nav');
  const pathname = usePathname();
  return (
    <nav className="jr-nav">
      {ENTREES.map((entree) => {
        const actif = estActif(pathname, entree.href);
        return (
          <Link key={entree.href} href={entree.href} className={actif ? 'actif' : undefined} aria-current={actif ? 'page' : undefined}>
            {entree.icone}
            {t(entree.cle)}
            {entree.cle === 'inbox' && aTraiterTotal > 0 && <b className="jr-badge">{aTraiterTotal}</b>}
          </Link>
        );
      })}
    </nav>
  );
}

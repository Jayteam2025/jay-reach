'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Sous-navigation des sept pages de Réglages (tâche 20, maquettes
 * `reglages-*.html`). Cinq des six autres pages ont déjà leur route neuve
 * (Fournisseurs, Personas, Messages, Expéditeurs — Moteur reste sur
 * l'ancienne `/settings/jobs` jusqu'à la tâche 23) : Plafonds et Compte
 * n'existent pas encore et s'affichent en lecture seule (`desactive`), pas en
 * lien mort.
 */
interface EntreeNavReglages {
  readonly cle: string;
  readonly href: string | null;
}

const ENTREES: EntreeNavReglages[] = [
  { cle: 'senders', href: '/settings/senders' },
  { cle: 'limits', href: null },
  { cle: 'providers', href: '/settings/providers' },
  { cle: 'personas', href: '/settings/personas' },
  { cle: 'messages', href: '/settings/messages' },
  { cle: 'engine', href: '/settings/jobs' },
  { cle: 'account', href: null },
];

export function NavReglages() {
  const pathname = usePathname();
  const t = useTranslations('reglages.nav');

  return (
    <nav className="jr-nav-reglages">
      {ENTREES.map((entree) =>
        entree.href ? (
          <Link
            key={entree.cle}
            href={entree.href}
            className={pathname.startsWith(entree.href) ? 'actif' : undefined}
            aria-current={pathname.startsWith(entree.href) ? 'page' : undefined}
          >
            {t(entree.cle)}
          </Link>
        ) : (
          <span key={entree.cle} className="desactive" title={t('bientot')} aria-disabled="true">
            {t(entree.cle)}
          </span>
        ),
      )}
    </nav>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Onglets } from '../ui';
import type { OngletItem } from '../ui';

/** Segments des six onglets qui suivent la Vue d'ensemble (tâches 10 à 13 : routes pas encore posées, on y lie déjà). */
const SEGMENTS_ONGLETS = ['contacts', 'queue', 'sources', 'sequence', 'activity', 'settings'] as const;

/**
 * Onglet actif d'après le chemin courant — fonction pure, exportée pour être
 * testée directement (le composant, lui, dépend de `usePathname`, illisible
 * par `renderToStaticMarkup` sans contexte App Router).
 */
export function ongletActif(pathname: string, campagneId: string): string {
  const base = `/campaigns/${campagneId}`;
  for (const segment of SEGMENTS_ONGLETS) {
    const href = `${base}/${segment}`;
    if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  }
  return base;
}

export interface CompteursOngletsCampagne {
  contacts: number;
  fileDuJour: number;
  sources: number;
}

export interface OngletsCampagneProps {
  campagneId: string;
  compteurs: CompteursOngletsCampagne;
}

export function OngletsCampagne({ campagneId, compteurs }: OngletsCampagneProps) {
  const pathname = usePathname();
  const t = useTranslations('campagne');
  const base = `/campaigns/${campagneId}`;

  const onglets: OngletItem[] = [
    { href: base, libelle: t('tabs.overview') },
    { href: `${base}/contacts`, libelle: t('tabs.contacts'), compteur: compteurs.contacts },
    { href: `${base}/queue`, libelle: t('tabs.queue'), compteur: compteurs.fileDuJour },
    { href: `${base}/sources`, libelle: t('tabs.sources'), compteur: compteurs.sources },
    { href: `${base}/sequence`, libelle: t('tabs.sequence') },
    { href: `${base}/activity`, libelle: t('tabs.activity') },
    { href: `${base}/settings`, libelle: t('tabs.settings') },
  ];

  return <Onglets onglets={onglets} actif={ongletActif(pathname, campagneId)} />;
}

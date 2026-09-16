import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { EnTetePage } from '../../../components/ui';
import { NavReglages } from '../../../components/reglages/NavReglages';

/**
 * En-tête et sous-navigation communs aux sept pages de Réglages (tâche 20,
 * maquettes `reglages-*.html`). Chaque page rend son propre contenu dans la
 * seconde colonne de la grille (`.jr-reglages`, `composants.css`) — aucune
 * page ne répète l'en-tête ni la nav, même geste que
 * `campaigns/[id]/layout.tsx` pour les sept onglets d'une campagne.
 */
export default async function ReglagesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('reglages');

  return (
    <>
      <EnTetePage titre={t('title')} description={t('lead')} />
      <section className="jr-contenu jr-reglages">
        <NavReglages />
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>{children}</div>
      </section>
    </>
  );
}

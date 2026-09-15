import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EtatVide } from '../../../components/ui';

/**
 * Frontière `not-found` du segment `campaigns/` (pas de `campaigns/[id]/`) :
 * dans l'App Router, un `not-found.tsx` enveloppe les enfants d'un segment
 * (page, segments imbriqués), jamais le `layout.tsx` du même segment — posé
 * ici, il rattrape aussi bien le `notFound()` de `[id]/layout.tsx` que celui
 * de `[id]/page.tsx` (tour de correction 1, point 1).
 */
export default async function CampagneIntrouvable() {
  const t = await getTranslations('campagne');
  return (
    <section className="jr-contenu une-colonne">
      <EtatVide
        titre={t('notFound.title')}
        texte={t('notFound.text')}
        action={
          <Link href="/campaigns" className="jr-bouton">
            {t('notFound.action')}
          </Link>
        }
      />
    </section>
  );
}

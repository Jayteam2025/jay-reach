'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toggleSourceProvider } from '../../actions/sources';

/**
 * Mise en pause d'un seul fournisseur d'un thème (retour 4.6).
 *
 * Quand une source déraille — quota épuisé, API qui change — on veut l'arrêter
 * sans interrompre la veille entière. Le thème continue de collecter chez les
 * autres.
 */
export function ProviderActions({
  orgId,
  sourceProviderId,
  isActive,
}: {
  orgId: string;
  sourceProviderId: string;
  isActive: boolean;
}) {
  const t = useTranslations('sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="rs-btn rs-btn-mini"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await toggleSourceProvider(orgId, sourceProviderId, !isActive);
            if (!res.ok) setErreur(res.error);
            router.refresh();
          })
        }
      >
        {isActive ? t('providerPause') : t('providerResume')}
      </button>
      {erreur ? (
        <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {erreur}
        </span>
      ) : null}
    </>
  );
}

'use client';

import { useOptimistic, useTransition, useState } from 'react';
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

  // Le libellé bascule à l'instant du clic, pas au retour du serveur.
  //
  // L'écriture et le rechargement de la page prennent ensemble près d'une
  // seconde, pendant laquelle le bouton affichait encore « Mettre en pause »
  // alors qu'on venait de le presser : on croyait le clic perdu et on
  // recommençait. Si l'écriture échoue, la transition se termine sans que la
  // valeur du serveur ait changé, et le libellé revient de lui-même.
  const [actifAffiche, poserActif] = useOptimistic(isActive);

  return (
    <>
      <button
        type="button"
        className="rs-btn rs-btn-mini"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            poserActif(!isActive);
            const res = await toggleSourceProvider(orgId, sourceProviderId, !isActive);
            if (!res.ok) setErreur(res.error);
            router.refresh();
          })
        }
      >
        {actifAffiche ? t('providerPause') : t('providerResume')}
      </button>
      {erreur ? (
        <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {erreur}
        </span>
      ) : null}
    </>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CampaignStatus } from '@jay-reach/core';
import { Bouton } from '../ui';
import { actionLancer, actionMettreEnPause } from '../../app/actions/campagne-cycle';

export interface BoutonLancerPauseProps {
  campagneId: string;
  statut: CampaignStatus;
}

/** Durée d'affichage de la notification d'échec (brief : disparition après 6 s). */
const DUREE_NOTIFICATION_MS = 6000;

/**
 * Bouton Lancer/Mettre en pause de l'en-tête de campagne. Pas de test par
 * `renderToStaticMarkup` (brief) : `useRouter` exige le contexte App Router,
 * absent en environnement de test — seule la vérification visuelle du
 * coordinateur couvre ce composant.
 */
export function BoutonLancerPause({ campagneId, statut }: BoutonLancerPauseProps) {
  const router = useRouter();
  const t = useTranslations('campagne');
  const [enCours, setEnCours] = useState(false);
  const [manques, setManques] = useState<string[] | null>(null);

  // Une campagne archivée ne se relance ni ne se met en pause (irréversible,
  // décision produit — `archiver` exige déjà le rôle admin côté fonction).
  if (statut === 'archived') return null;

  const enAttenteDeLancement = statut !== 'active';

  async function activer() {
    setEnCours(true);
    setManques(null);
    try {
      const resultat = enAttenteDeLancement ? await actionLancer(campagneId) : await actionMettreEnPause(campagneId);
      if (resultat.ok) {
        router.refresh();
      } else {
        setManques(resultat.manques);
        setTimeout(() => setManques(null), DUREE_NOTIFICATION_MS);
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <Bouton variante="principal" aria-busy={enCours} disabled={enCours} onClick={activer}>
        {enAttenteDeLancement ? t('header.launch') : t('header.pause')}
      </Bouton>
      {manques && (
        <div className="jr-notification erreur" role="alert">
          {t('notifications.launchBlocked', { liste: manques.join(' ; ') })}
        </div>
      )}
    </>
  );
}

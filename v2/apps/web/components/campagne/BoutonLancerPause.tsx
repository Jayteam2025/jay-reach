'use client';

import { useState } from 'react';
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

/** Icône « Mettre en pause » recopiée telle quelle de `campagne-vue.html` (deux barres). Purement décorative (le sens est porté par le texte du bouton), d'où `aria-hidden`. */
function IconePause() {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

/**
 * Bouton Lancer/Mettre en pause de l'en-tête de campagne. Pas de test par
 * `renderToStaticMarkup` (brief) : `useRouter` exige le contexte App Router,
 * absent en environnement de test — seule la vérification visuelle du
 * coordinateur couvre ce composant.
 */
export function BoutonLancerPause({ campagneId, statut }: BoutonLancerPauseProps) {
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
      <Bouton
        variante="principal"
        icone={!enAttenteDeLancement ? <IconePause /> : undefined}
        aria-busy={enCours}
        disabled={enCours}
        onClick={activer}
      >
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

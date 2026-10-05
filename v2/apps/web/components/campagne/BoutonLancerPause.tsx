'use client';

import { useRef, useState, useTransition } from 'react';
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
 * Bouton Lancer/Mettre en pause de l'en-tête de campagne. `statut` vient du
 * layout de la campagne : l'action le revalide (`revaliderLayoutCampagne`) et
 * la prop change quand l'arbre revalidé est appliqué, un instant APRÈS que
 * l'action a répondu. Dans cet intervalle, et tant que `statut` n'a pas bougé,
 * un second clic rejouerait `lancer` : le bouton reste donc verrouillé (a)
 * synchroniquement dès le premier clic (`enVol`, un double clic dans le même
 * tick passe avant tout re-rendu) et (b) après un succès, jusqu'à ce que la
 * prop `statut` change réellement.
 */
export function BoutonLancerPause({ campagneId, statut }: BoutonLancerPauseProps) {
  const t = useTranslations('campagne');
  const [enCours, startTransition] = useTransition();
  const [manques, setManques] = useState<string[] | null>(null);
  const [reussiDepuis, setReussiDepuis] = useState<CampaignStatus | null>(null);
  const enVol = useRef(false);

  // Une campagne archivée ne se relance ni ne se met en pause (irréversible,
  // décision produit — `archiver` exige déjà le rôle admin côté fonction).
  if (statut === 'archived') return null;

  const enAttenteDeLancement = statut !== 'active';
  const verrouille = enCours || reussiDepuis === statut;

  function activer() {
    if (enVol.current || reussiDepuis === statut) return;
    enVol.current = true;
    setManques(null);
    startTransition(async () => {
      try {
        const resultat = enAttenteDeLancement ? await actionLancer(campagneId) : await actionMettreEnPause(campagneId);
        if (resultat.ok) {
          setReussiDepuis(statut);
        } else {
          setManques(resultat.manques);
          setTimeout(() => setManques(null), DUREE_NOTIFICATION_MS);
        }
      } finally {
        enVol.current = false;
      }
    });
  }

  return (
    <>
      <Bouton
        variante="principal"
        icone={!enAttenteDeLancement ? <IconePause /> : undefined}
        aria-busy={verrouille}
        disabled={verrouille}
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

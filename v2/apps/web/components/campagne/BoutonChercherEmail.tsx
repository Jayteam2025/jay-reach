'use client';

import { useState, useTransition } from 'react';
import { enrichirMaintenant } from '../../app/actions/enrichir';

export interface BoutonChercherEmailProps {
  organisationId: string;
  signalId: string;
  libelle: string;
  cout: string;
}

/**
 * Bouton « Chercher l'email » (onglets Contacts et File du jour d'une
 * campagne) : réutilise la façade existante `enrichirMaintenant`
 * (`apps/web/app/actions/enrichir.ts`), déjà branchée depuis l'ancien écran
 * Prospects (`signals-board.tsx`, retiré à la tâche 24).
 *
 * Pas de `useRouter`/`useTranslations` ici (labels reçus en props, un
 * rechargement complet plutôt que `router.refresh()`) : rendu dans une table
 * testée par `renderToStaticMarkup`, sans contexte App Router ni next-intl —
 * même contrainte que documentée sur `BoutonLancerPause`, résolue autrement.
 */
export function BoutonChercherEmail({ organisationId, signalId, libelle, cout }: BoutonChercherEmailProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await enrichirMaintenant(organisationId, signalId);
      if (res.ok) {
        setFait(true);
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  if (fait) {
    return <span className="jr-secondaire">{cout}</span>;
  }

  return (
    // Coût empilé sous le bouton plutôt qu'à côté (tour de correction F6, point 20) : la version
    // en ligne ajoutait sa largeur à celle du bouton, ce qui poussait la colonne Statut/Action des
    // tableaux de contacts bien au-delà de son contenu réel.
    <span className="jr-action-empilee">
      <button type="button" className="jr-bouton petit" disabled={pending} aria-busy={pending} onClick={lancer}>
        {libelle}
      </button>
      <small className="jr-secondaire">{erreur ?? cout}</small>
    </span>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { enrichirMaintenant } from '../../app/actions/enrichir';

export interface BoutonChercherEmailProps {
  organisationId: string;
  signalId: string;
  libelle: string;
  cout: string;
  /**
   * Motif déjà traduit d'indisponibilité — non `null` quand `enrichissements_par_jour`
   * (réglages de l'organisation) vaut 0 : l'enrichissement est en pause pour TOUTE
   * l'organisation, ce bouton ne peut alors structurellement rien faire (constat produit,
   * 18/09, tour de correction G4). Chargé une seule fois par la page (jamais par ligne de
   * table) et transmis ici — voir le commentaire de `TableContactsLibelles`. Bouton gardé
   * visible mais désactivé, avec ce texte dessous (`.jr-tache-aide`), plutôt que d'échouer
   * après le clic.
   */
  raisonIndisponible: string | null;
}

/**
 * Bouton « Chercher l'email » (onglets Contacts et File du jour d'une
 * campagne) : réutilise la façade existante `enrichirMaintenant`
 * (`apps/web/app/actions/enrichir.ts`), déjà branchée depuis l'ancien écran
 * Prospects (`signals-board.tsx`, retiré à la tâche 24).
 *
 * Pas de `useRouter`/`useTranslations` ici (labels reçus en props, la
 * Server Action revalide les pages concernées) : rendu dans une table
 * testée par `renderToStaticMarkup`, sans contexte App Router ni next-intl —
 * même contrainte que documentée sur `BoutonLancerPause`, résolue autrement.
 */
export function BoutonChercherEmail({ organisationId, signalId, libelle, cout, raisonIndisponible }: BoutonChercherEmailProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer() {
    setErreur(null);
    startTransition(async () => {
      const res = await enrichirMaintenant(organisationId, signalId);
      if (!res.ok) setErreur(res.error);
    });
  }

  // Plafond à 0 (constat produit, 18/09) : bouton visible mais désactivé, avec la raison
  // dessous — même idiome que `TableTaches` (`.jr-tache-aide`) pour un bouton qui ne ferait
  // jamais rien aujourd'hui, plutôt qu'un échec après le clic.
  if (raisonIndisponible) {
    return (
      <span className="jr-action-empilee">
        <button type="button" className="jr-bouton petit" disabled>
          {libelle}
        </button>
        <p className="jr-aide jr-tache-aide">{raisonIndisponible}</p>
      </span>
    );
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

'use client';

import { useState, useTransition } from 'react';
import { Bouton } from '../ui';
import { marquerTraite } from '../../app/actions/inbox';

export interface BoutonMarquerTraiteProps {
  filId: string;
  traite: boolean;
  libelleMarquer: string;
  libelleRouvrir: string;
}

/**
 * Bascule `handled_at` (posé/retiré) — façade `marquerTraite`
 * (`app/actions/inbox.ts` → `packages/core/src/fonctions/reception.ts`).
 * Rechargement complet après succès, même convention que
 * `BoutonEcarterContact` (tâche 11/13) : pas de `router.refresh`, la Réception
 * n'a pas besoin de préserver un état client au-delà de ce que l'URL porte
 * déjà (filtre, campagne, fil sélectionné).
 */
export function BoutonMarquerTraite({ filId, traite, libelleMarquer, libelleRouvrir }: BoutonMarquerTraiteProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function basculer() {
    setErreur(null);
    startTransition(async () => {
      const res = await marquerTraite(filId, !traite);
      if (res.ok) {
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Bouton taille="petit" disabled={pending} aria-busy={pending} onClick={basculer}>
        {traite ? libelleRouvrir : libelleMarquer}
      </Bouton>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </span>
  );
}

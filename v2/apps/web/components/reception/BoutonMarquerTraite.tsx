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
 * La Server Action `marquerTraite` revalide `/inbox` ET le layout
 * (le badge de la barre latérale en dépend) : pas de rechargement complet ni de
 * `router.refresh`, l'état que l'URL porte (filtre, campagne, fil sélectionné)
 * est conservé.
 */
export function BoutonMarquerTraite({ filId, traite, libelleMarquer, libelleRouvrir }: BoutonMarquerTraiteProps) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function basculer() {
    setErreur(null);
    startTransition(async () => {
      const res = await marquerTraite(filId, !traite);
      if (!res.ok) setErreur(res.error);
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

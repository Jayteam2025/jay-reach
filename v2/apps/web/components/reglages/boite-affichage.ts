/**
 * Logique d'affichage pure de la carte d'une boîte email (tâche 20) —
 * séparée de `CarteBoite.tsx` pour rester testable sans `useRouter`/contexte
 * App Router (même exemption que `BoutonLancerPause.tsx`, dont le composant
 * lui-même ne s'unit-teste pas).
 */
import type { Boite } from '@jay-reach/core';
import type { PuceTon } from '../ui';

/**
 * Puce d'état d'une carte de boîte : priorité à ce qui empêche vraiment
 * d'envoyer ou de recevoir (non reliée, santé indisponible, déconnectée),
 * puis seulement l'activation choisie par l'opérateur.
 */
export function puceEtatBoite(boite: Pick<Boite, 'active' | 'sante'>): { ton: PuceTon; cle: string } {
  if (boite.sante.etat === 'sans_objet') return { ton: 'gris', cle: 'notLinked' };
  if (boite.sante.etat === 'indisponible') return { ton: 'attention', cle: 'healthUnavailable' };
  if (boite.sante.etat === 'connue' && !boite.sante.connectee) return { ton: 'attention', cle: 'disconnected' };
  return boite.active ? { ton: 'bon', cle: 'active' } : { ton: 'gris', cle: 'inactive' };
}

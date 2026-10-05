import type { ReactNode } from 'react';
import { Coquille } from '../../components/coquille/Coquille';
import { contexteCourant } from '../../lib/contexte';

/**
 * Coquille du poste de pilotage : barre latérale à cinq entrées, carte
 * Moteur, jauge d'envois, bloc utilisateur. `login/` reste hors de ce groupe
 * de routes (racine de `app/`) — c'est précisément le but d'un groupe.
 */
export default async function CoquilleLayout({ children }: { children: ReactNode }) {
  const ctx = await contexteCourant();
  return <Coquille ctx={ctx}>{children}</Coquille>;
}

/**
 * Le détail réservé à qui tient le serveur (adresse IP, opérateur, identifiants de connexion) :
 * replié par défaut, pour que l'écran se lise sans lui. Même repli (`jr-repli`) que les
 * « Réglages avancés » de l'écran LinkedIn. Composant serveur, aucun état : `<details>` natif.
 */
import type { ReactNode } from 'react';

export interface DetailsTechniquesProps {
  /** Le titre du repli, déjà traduit (« Détails techniques »). */
  titre: string;
  children: ReactNode;
}

export function DetailsTechniques({ titre, children }: DetailsTechniquesProps) {
  return (
    <details className="jr-repli">
      <summary>{titre}</summary>
      <div className="jr-repli-corps">{children}</div>
    </details>
  );
}

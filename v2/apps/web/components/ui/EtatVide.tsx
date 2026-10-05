import type { ReactNode } from 'react';

export type EtatVideProps = {
  titre: string;
  texte: string;
  action?: ReactNode;
};

export function EtatVide({ titre, texte, action }: EtatVideProps) {
  return (
    <div className="jr-carte">
      <div className="jr-vide">
        <b>{titre}</b>
        <p>{texte}</p>
        {action}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';

export type CarteProps = {
  titre?: ReactNode;
  action?: ReactNode;
  // En-tête personnalisé (remplace titre/action), rendu dans .jr-carte-h : utile
  // pour les en-têtes composés (ex. un bloc jr-qui), déjà prévu par composants.css.
  entete?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Carte({ titre, action, entete, className, children }: CarteProps) {
  const classe = ['jr-carte', className].filter(Boolean).join(' ');
  return (
    <div className={classe}>
      {entete ? (
        <div className="jr-carte-h">{entete}</div>
      ) : titre ? (
        <h3>
          {titre}
          {action}
        </h3>
      ) : null}
      <div className="jr-corps">{children}</div>
    </div>
  );
}

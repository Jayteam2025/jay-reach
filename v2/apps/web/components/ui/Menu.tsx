'use client';

import type { ReactNode } from 'react';

export type EntreeMenu = {
  icone: ReactNode;
  titre: ReactNode;
  description?: ReactNode;
  actif?: boolean;
  /** Entrée affichée mais inerte (ex. import CSV, indisponible avant la création de la campagne) : pas de `onSelectionner`, pas de rôle interactif. */
  desactive?: boolean;
  onSelectionner?: () => void;
};

export type GroupeMenu = {
  titre: string;
  entrees: EntreeMenu[];
};

export type MenuProps = {
  groupes: GroupeMenu[];
  className?: string;
};

export function Menu({ groupes, className }: MenuProps) {
  const classe = ['jr-menu', className].filter(Boolean).join(' ');
  return (
    <div className={classe}>
      {groupes.map((groupe, indexGroupe) => (
        <div key={indexGroupe}>
          <h5>{groupe.titre}</h5>
          {groupe.entrees.map((entree, indexEntree) => (
            <div
              key={indexEntree}
              className={['entree', entree.actif ? 'actif' : undefined, entree.desactive ? 'desactive' : undefined]
                .filter(Boolean)
                .join(' ')}
              onClick={entree.desactive ? undefined : entree.onSelectionner}
              role={!entree.desactive && entree.onSelectionner ? 'button' : undefined}
              tabIndex={!entree.desactive && entree.onSelectionner ? 0 : undefined}
              aria-disabled={entree.desactive || undefined}
            >
              {entree.icone}
              <span>
                <b>{entree.titre}</b>
                {entree.description && <small>{entree.description}</small>}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

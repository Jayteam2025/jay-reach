'use client';

import type { ReactNode } from 'react';

export type TiroirProps = {
  ouvert: boolean;
  titre: ReactNode;
  description?: ReactNode;
  puces?: ReactNode;
  icone?: ReactNode;
  pied?: ReactNode;
  onFermer: () => void;
  libelleFermer: string;
  children?: ReactNode;
};

export function Tiroir({
  ouvert,
  titre,
  description,
  puces,
  icone,
  pied,
  onFermer,
  libelleFermer,
  children,
}: TiroirProps) {
  if (!ouvert) return null;
  return (
    <>
      <div className="jr-voile" onClick={onFermer} />
      <aside className="jr-tiroir">
        <div className="entete">
          {icone}
          <div>
            <h2>{titre}</h2>
            {description && <p>{description}</p>}
            {puces && <div className="jr-puces">{puces}</div>}
          </div>
          <button type="button" className="fermer" aria-label={libelleFermer} onClick={onFermer}>
            ×
          </button>
        </div>
        <div className="corps">{children}</div>
        {pied && <div className="pied">{pied}</div>}
      </aside>
    </>
  );
}

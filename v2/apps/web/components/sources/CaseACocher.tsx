'use client';

import type { ReactNode } from 'react';

export interface CaseACocherProps {
  coche: boolean;
  onChange: (coche: boolean) => void;
  children: ReactNode;
}

/**
 * Case à cocher stylée `.jr-case` (composants.css, tâches précédentes) :
 * un `<i>` vide dont la classe `coche` porte toute l'indication visuelle,
 * jamais une case native — reprend ce que les maquettes des tiroirs Sources
 * dessinent (`jr-case coche`). Un `<button>`, pas un `<label>` sans `<input>`
 * associé : correctement focusable et actionnable au clavier sans rôle ARIA
 * à poser à la main.
 */
export function CaseACocher({ coche, onChange, children }: CaseACocherProps) {
  return (
    <button
      type="button"
      className={`jr-case${coche ? ' coche' : ''}`}
      role="checkbox"
      aria-checked={coche}
      onClick={() => onChange(!coche)}
    >
      <i />
      {children}
    </button>
  );
}

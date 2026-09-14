import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type BoutonVariante = 'principal' | 'secondaire' | 'sombre' | 'danger';
export type BoutonTaille = 'normal' | 'petit';

export type BoutonProps = {
  variante?: BoutonVariante;
  taille?: BoutonTaille;
  icone?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

// « secondaire » est le bouton par défaut du kit (bordure filet, fond surface) :
// composants.css ne porte pas de classe .secondaire, il n'y a rien à lui ajouter.
export function Bouton({ variante, taille, icone, className, children, ...props }: BoutonProps) {
  const classe = [
    'jr-bouton',
    variante && variante !== 'secondaire' ? variante : undefined,
    taille === 'petit' ? 'petit' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classe} {...props}>
      {icone}
      {children}
    </button>
  );
}

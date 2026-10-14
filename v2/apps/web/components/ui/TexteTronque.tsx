/**
 * Un texte coupé par l'ellipse porte toujours son texte complet.
 *
 * `.jr-tronque` coupe à la largeur de sa colonne. Mesuré le 14/10 sur la liste des contacts, un
 * intitulé de poste perdait 982 px : « Regional Sales Manager | Team Leadership… » et rien, nulle
 * part, ne disait la suite. Le lecteur ne pouvait ni la lire, ni savoir qu'il lui manquait quelque
 * chose.
 *
 * Ce composant existe pour que la classe et l'attribut `title` ne puissent plus être séparés :
 * poser l'une sans l'autre redevient un geste qu'il faut écrire exprès, et qu'un test refuse.
 */
import type { ElementType, ReactNode } from 'react';

export interface TexteTronqueProps {
  /** Le texte, affiché et repris en entier dans l'infobulle. */
  children: string;
  /** La balise à rendre : `span` par défaut, `b` quand le texte est le nom de la ligne. */
  balise?: Extract<ElementType, 'span' | 'b' | 'small' | 'div'>;
  /** Classes du produit à ajouter (`jr-petit`, par exemple). */
  className?: string;
}

export function TexteTronque({ children, balise, className }: TexteTronqueProps): ReactNode {
  const Balise = balise ?? 'span';
  return (
    <Balise className={className ? `${className} jr-tronque` : 'jr-tronque'} title={children}>
      {children}
    </Balise>
  );
}

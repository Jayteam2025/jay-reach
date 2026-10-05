import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type ChampProps = {
  libelle?: ReactNode;
  suffixe?: ReactNode;
  erreur?: ReactNode;
  className?: string;
  /**
   * Id du champ contrôlé (tour de correction 2, R66). Optionnel : sans lui,
   * `Champ` en génère un lui-même (`useId()`, tour de correction F6, point 7)
   * et le relie à l'enfant — un `<input>`/`<select>`/`<textarea>` unique reçoit
   * automatiquement cet `id` (et un `name` s'il n'en a pas) tant qu'il n'a pas
   * déjà son propre `id`. L'appelant peut toujours poser un `id` explicite
   * (sur `Champ` ET sur l'enfant) pour le cas où un autre code a besoin de le
   * connaître ; c'est alors celui-là qui est utilisé.
   */
  id?: string;
  children: ReactNode;
};

/** Clone l'enfant unique d'un `Champ` pour lui poser `id` (et `name` si absent), sauf s'il a déjà son propre `id`. */
function relierEnfant(enfant: ReactNode, id: string): ReactNode {
  if (!isValidElement(enfant)) return enfant;
  const props = enfant.props as { id?: string; name?: string };
  if (props.id) return enfant;
  const balise = typeof enfant.type === 'string' ? enfant.type : undefined;
  if (balise === 'input') {
    return cloneElement(enfant as ReactElement<InputHTMLAttributes<HTMLInputElement>>, {
      id,
      name: props.name ?? id,
    });
  }
  if (balise === 'select') {
    return cloneElement(enfant as ReactElement<SelectHTMLAttributes<HTMLSelectElement>>, {
      id,
      name: props.name ?? id,
    });
  }
  if (balise === 'textarea') {
    return cloneElement(enfant as ReactElement<TextareaHTMLAttributes<HTMLTextAreaElement>>, {
      id,
      name: props.name ?? id,
    });
  }
  // Autre balise ou composant (ex. un wrapper qui pose lui-même son id) : inchangé — seuls les
  // trois contrôles de formulaire natifs ci-dessus ont besoin qu'on les relie automatiquement.
  return enfant;
}

export function Champ({ libelle, suffixe, erreur, className, id, children }: ChampProps) {
  const idGenere = useId();
  const idEffectif = id ?? idGenere;
  const classe = ['jr-champ', erreur ? 'erreur' : undefined].filter(Boolean).join(' ');
  const enfant = relierEnfant(children, idEffectif);
  return (
    <div className={className}>
      {libelle && (
        <label className="jr-libelle" htmlFor={idEffectif}>
          {libelle}
        </label>
      )}
      <div className={classe}>
        {enfant}
        {suffixe && <small>{suffixe}</small>}
      </div>
      {erreur && <div className="jr-aide-erreur">{erreur}</div>}
    </div>
  );
}

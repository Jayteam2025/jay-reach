import type { ReactNode } from 'react';

export type ChampProps = {
  libelle?: ReactNode;
  suffixe?: ReactNode;
  erreur?: ReactNode;
  className?: string;
  /**
   * Id du champ contrôlé (tour de correction 2, R66) : posé, le libellé
   * devient un vrai `<label htmlFor>` au lieu d'un `<span>` — l'appelant reste
   * responsable de poser LE MÊME `id` sur son `<input>`/`<textarea>`/`<select>`.
   * Optionnel et rétrocompatible : sans lui, rien ne change (`<span>` nu).
   */
  id?: string;
  children: ReactNode;
};

export function Champ({ libelle, suffixe, erreur, className, id, children }: ChampProps) {
  const classe = ['jr-champ', erreur ? 'erreur' : undefined].filter(Boolean).join(' ');
  const Libelle = id ? 'label' : 'span';
  return (
    <div className={className}>
      {libelle && (
        <Libelle className="jr-libelle" {...(id ? { htmlFor: id } : {})}>
          {libelle}
        </Libelle>
      )}
      <div className={classe}>
        {children}
        {suffixe && <small>{suffixe}</small>}
      </div>
      {erreur && <div className="jr-aide-erreur">{erreur}</div>}
    </div>
  );
}

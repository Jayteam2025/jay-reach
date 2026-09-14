import type { ReactNode } from 'react';

export type ChampProps = {
  libelle?: ReactNode;
  suffixe?: ReactNode;
  erreur?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Champ({ libelle, suffixe, erreur, className, children }: ChampProps) {
  const classe = ['jr-champ', erreur ? 'erreur' : undefined].filter(Boolean).join(' ');
  return (
    <div className={className}>
      {libelle && <span className="jr-libelle">{libelle}</span>}
      <div className={classe}>
        {children}
        {suffixe && <small>{suffixe}</small>}
      </div>
      {erreur && <div className="jr-aide-erreur">{erreur}</div>}
    </div>
  );
}

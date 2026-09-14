import type { ReactNode } from 'react';

export type CleValeurProps = {
  libelle: ReactNode;
  valeur: ReactNode;
};

export function CleValeur({ libelle, valeur }: CleValeurProps) {
  return (
    <div className="jr-cle-valeur">
      <span>{libelle}</span>
      <b>{valeur}</b>
    </div>
  );
}

import type { ReactNode } from 'react';

export type FiltresProps = {
  children: ReactNode;
  className?: string;
};

export function Filtres({ children, className }: FiltresProps) {
  const classe = ['jr-filtres', className].filter(Boolean).join(' ');
  return <div className={classe}>{children}</div>;
}

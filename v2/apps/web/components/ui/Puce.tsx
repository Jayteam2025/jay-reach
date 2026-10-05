import type { ReactNode } from 'react';

export type PuceTon = 'bon' | 'attention' | 'erreur' | 'accent' | 'li' | 'gris';

export type PuceProps = {
  ton?: PuceTon;
  point?: boolean;
  children?: ReactNode;
};

export function Puce({ ton, point, children }: PuceProps) {
  const classe = ['jr-puce', ton].filter(Boolean).join(' ');
  return (
    <span className={classe}>
      {point && <span className="point" />}
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';

export type EnTetePageProps = {
  titre: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EnTetePage({ titre, description, action }: EnTetePageProps) {
  return (
    <div className="jr-entete-page">
      <div>
        <h1>{titre}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

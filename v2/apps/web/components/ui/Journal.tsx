import type { ReactNode } from 'react';

export type EntreeJournal = {
  heure: string;
  texte: ReactNode;
  note?: ReactNode;
  ton?: 'erreur' | 'attention';
};

export type JournalProps = {
  entrees: EntreeJournal[];
};

export function Journal({ entrees }: JournalProps) {
  return (
    <ul className="jr-journal">
      {entrees.map((entree, index) => (
        <li key={index}>
          <time>{entree.heure}</time>
          <span className={entree.ton}>
            {entree.texte}
            {entree.note && <small>{entree.note}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

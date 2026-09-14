import type { ReactNode } from 'react';

export type MessageProps = {
  direction: 'entrant' | 'sortant';
  auteur: ReactNode;
  date: string;
  objet?: string;
  corps: string;
};

export function Message({ direction, auteur, date, objet, corps }: MessageProps) {
  return (
    <div className={`jr-message ${direction}`}>
      <div className="entete">
        <span>
          <b>{auteur}</b>
          {objet && <> · {objet}</>}
        </span>
        <span>{date}</span>
      </div>
      <div className="corps">{corps}</div>
    </div>
  );
}

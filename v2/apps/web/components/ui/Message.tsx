import type { ReactNode } from 'react';

export type MessageProps = {
  direction: 'entrant' | 'sortant';
  auteur: ReactNode;
  date: string;
  /** Destinataire complet (« à jean@exemple.fr ») — sa propre ligne, jamais glissé dans `date` (R38, tour de correction 1 : un écran de relecture ne masque jamais l'adresse). */
  destinataire?: string;
  /** Rendu entre la ligne du destinataire et le corps (tiroir « Relire avant envoi » : avertissement des variables manquantes, C5). */
  avertissement?: ReactNode;
  objet?: string;
  corps: string;
};

export function Message({ direction, auteur, date, destinataire, avertissement, objet, corps }: MessageProps) {
  return (
    <div className={`jr-message ${direction}`}>
      <div className="entete">
        <span>
          <b>{auteur}</b>
        </span>
        <span>{date}</span>
      </div>
      {destinataire && <div className="jr-message-destinataire">à {destinataire}</div>}
      {avertissement}
      <div className="corps">
        {objet && <b className="jr-message-objet">{objet}</b>}
        {corps}
      </div>
    </div>
  );
}

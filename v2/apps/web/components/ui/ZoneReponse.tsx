import type { ChangeEvent, ReactNode } from 'react';

export type ZoneReponseProps = {
  depuis: ReactNode;
  placeholder?: string;
  note?: ReactNode;
  actions?: ReactNode;
  value?: string;
  onChange?: (valeur: string) => void;
};

export function ZoneReponse({ depuis, placeholder, note, actions, value, onChange }: ZoneReponseProps) {
  const gererChangement = onChange
    ? (evenement: ChangeEvent<HTMLTextAreaElement>) => onChange(evenement.target.value)
    : undefined;
  return (
    <div className="jr-reponse">
      <div className="depuis">{depuis}</div>
      <textarea placeholder={placeholder} value={value} onChange={gererChangement} />
      <div className="pied">
        <span className="jr-secondaire" style={{ fontSize: '12.5px' }}>
          {note}
        </span>
        <div className="jr-actions">{actions}</div>
      </div>
    </div>
  );
}

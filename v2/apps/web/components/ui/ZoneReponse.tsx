import { useId, type ChangeEvent, type ReactNode } from 'react';

export type ZoneReponseProps = {
  depuis: ReactNode;
  placeholder?: string;
  note?: ReactNode;
  actions?: ReactNode;
  value?: string;
  onChange?: (valeur: string) => void;
  /**
   * Raison pour laquelle on ne peut pas répondre. Quand elle est posée, le champ est désactivé
   * et la raison est rendue AVANT lui : on la lit avant de vouloir écrire, et le champ y renvoie
   * (`aria-describedby`) pour les lecteurs d'écran.
   */
  raisonIndisponible?: ReactNode;
};

export function ZoneReponse({ depuis, placeholder, note, actions, value, onChange, raisonIndisponible }: ZoneReponseProps) {
  const idRaison = useId();
  const indisponible = raisonIndisponible !== undefined && raisonIndisponible !== null;
  const gererChangement = onChange
    ? (evenement: ChangeEvent<HTMLTextAreaElement>) => onChange(evenement.target.value)
    : undefined;
  return (
    <div className="jr-reponse">
      <div className="depuis">{depuis}</div>
      {indisponible ? (
        <p id={idRaison} className="jr-reponse-raison jr-petit">
          {raisonIndisponible}
        </p>
      ) : null}
      <textarea
        name="reponse"
        placeholder={placeholder}
        value={value}
        onChange={gererChangement}
        disabled={indisponible}
        aria-describedby={indisponible ? idRaison : undefined}
      />
      <div className="pied">
        <span className="jr-secondaire jr-petit">{note}</span>
        <div className="jr-actions">{actions}</div>
      </div>
    </div>
  );
}

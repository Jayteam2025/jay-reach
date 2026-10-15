/**
 * Puces des variables offertes à l'insertion, dans le tiroir d'étape et dans celui des modèles :
 * UNE seule présentation et UNE seule source, `variablesProposees` (`@jay-reach/core`, dérivée de
 * `STANDARD_VARIABLES`). Partie pure (le libellé arrive résolu) : testable par
 * `renderToStaticMarkup`, sans fournisseur `next-intl`.
 */
export interface PucesVariablesProps {
  readonly variables: readonly string[];
  readonly onInserer: (nom: string) => void;
  /** Libellé d'une variable, en infobulle : dit ce qu'elle rend sans changer le jeton affiché. */
  readonly libelle: (nom: string) => string;
}

export function PucesVariables({ variables, onInserer, libelle }: PucesVariablesProps) {
  return (
    <div className="jr-puces variables">
      {variables.map((nom) => (
        <button
          key={nom}
          type="button"
          className="jr-puce variable"
          title={libelle(nom)}
          onClick={() => onInserer(nom)}
        >
          {`{{${nom}}}`}
        </button>
      ))}
    </div>
  );
}

import Link from 'next/link';
import { Carte, Champ } from '../../ui';

export interface PersonaOptionAssistant {
  readonly id: string;
  readonly nom: string;
}

export interface EtapeQuiLibelles {
  nom: string;
  nomPlaceholder: string;
  personaTitre: string;
  personaVide: string;
  personaNouveau: string;
  personaNouveauAide: string;
  scoreMin: string;
  scoreMinSuffixe: string;
  scoreMinAide: string;
  plafondJour: string;
  plafondJourSuffixe: string;
  plafondJourAide: string;
}

export interface EtapeQuiProps {
  nom: string;
  onNomChange: (valeur: string) => void;
  personas: readonly PersonaOptionAssistant[];
  personaId: string | null;
  onPersonaIdChange: (id: string) => void;
  scoreMin: string;
  onScoreMinChange: (valeur: string) => void;
  plafondJour: string;
  onPlafondJourChange: (valeur: string) => void;
  disabled: boolean;
  libelles: EtapeQuiLibelles;
}

/**
 * Étape « Qui » de l'assistant (maquette `nouvelle-campagne-1.html`) :
 * entièrement présentationnelle (aucun `useState`), l'état vit dans
 * `Assistant` — même découpage que `CorpsReglagesCampagne`/
 * `FormulaireReglagesCampagne`, pour rester testable par
 * `renderToStaticMarkup`.
 *
 * Un seul persona sélectionnable (choix unique, comme la maquette) : créer un
 * nouveau persona reste hors de cet assistant (aucune fonction `creerPersona`
 * dans `packages/core` à ce jour) — la tuile pointillée renvoie vers l'écran
 * Réglages › Personas existant, comme les boîtes d'envoi le font déjà pour
 * l'onglet Réglages d'une campagne.
 */
export function EtapeQui({
  nom,
  onNomChange,
  personas,
  personaId,
  onPersonaIdChange,
  scoreMin,
  onScoreMinChange,
  plafondJour,
  onPlafondJourChange,
  disabled,
  libelles,
}: EtapeQuiProps) {
  return (
    <Carte>
      <div className="jr-formulaire">
        <Champ libelle={libelles.nom}>
          <input
            value={nom}
            onChange={(e) => onNomChange(e.target.value)}
            placeholder={libelles.nomPlaceholder}
            disabled={disabled}
          />
        </Champ>

        <div>
          <span className="jr-libelle">{libelles.personaTitre}</span>
          {personas.length === 0 && <p className="jr-aide">{libelles.personaVide}</p>}
          <div className="jr-choix">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className={['option', personaId === persona.id ? 'actif' : undefined].filter(Boolean).join(' ')}
                role="button"
                tabIndex={0}
                aria-pressed={personaId === persona.id}
                onClick={() => !disabled && onPersonaIdChange(persona.id)}
              >
                <b>{persona.nom}</b>
              </div>
            ))}
            <Link href="/settings/personas" className="option pointille">
              <b>{libelles.personaNouveau}</b>
              <small>{libelles.personaNouveauAide}</small>
            </Link>
          </div>
        </div>

        <div className="ligne">
          <div>
            <Champ libelle={libelles.scoreMin} suffixe={libelles.scoreMinSuffixe}>
              <input
                type="number"
                min={0}
                max={100}
                value={scoreMin}
                onChange={(e) => onScoreMinChange(e.target.value)}
                disabled={disabled}
              />
            </Champ>
            <div className="jr-aide">{libelles.scoreMinAide}</div>
          </div>
          <div>
            <Champ libelle={libelles.plafondJour} suffixe={libelles.plafondJourSuffixe}>
              <input
                type="number"
                min={1}
                value={plafondJour}
                onChange={(e) => onPlafondJourChange(e.target.value)}
                disabled={disabled}
              />
            </Champ>
            <div className="jr-aide">{libelles.plafondJourAide}</div>
          </div>
        </div>
      </div>
    </Carte>
  );
}

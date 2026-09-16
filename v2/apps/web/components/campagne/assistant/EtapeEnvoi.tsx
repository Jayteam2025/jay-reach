import { Carte, Champ, CleValeur, Interrupteur, TuileLogo } from '../../ui';

export interface BoiteEnvoiAssistant {
  readonly id: string;
  readonly identite: string;
  readonly marque: 'outlook' | 'gmail' | null;
}

export interface RecapitulatifAssistant {
  readonly persona: string;
  readonly sources: string;
  readonly sequence: string;
  readonly envoi: string;
}

export interface EtapeEnvoiLibelles {
  boitesTitre: string;
  boitesVide: string;
  relecture: string;
  relectureSuffixe: string;
  relectureAide: string;
  recapTitre: string;
  recapPersona: string;
  recapSources: string;
  recapSequence: string;
  recapEnvoi: string;
  recapPremierPassage: string;
  recapPremierPassageValeur: string;
  erreurLancement: string;
}

export interface EtapeEnvoiProps {
  boites: readonly BoiteEnvoiAssistant[];
  boiteIdsDesactivees: ReadonlySet<string>;
  onToggleBoite: (id: string, actif: boolean) => void;
  relecture: string;
  onRelectureChange: (valeur: string) => void;
  disabled: boolean;
  recapitulatif: RecapitulatifAssistant;
  manques: readonly string[];
  libelles: EtapeEnvoiLibelles;
}

/** Étape « Envoi » de l'assistant (maquette `nouvelle-campagne-4.html`) : boîtes, relecture, récapitulatif final. */
export function EtapeEnvoi({
  boites,
  boiteIdsDesactivees,
  onToggleBoite,
  relecture,
  onRelectureChange,
  disabled,
  recapitulatif,
  manques,
  libelles,
}: EtapeEnvoiProps) {
  return (
    <>
      <Carte titre={libelles.boitesTitre}>
        {boites.length === 0 ? (
          <p className="jr-aide">{libelles.boitesVide}</p>
        ) : (
          boites.map((boite) => (
            <div key={boite.id} className="jr-boite">
              {/* Boîte de marque inconnue (domaine propre) : repli sur la tuile « @ », comme `PileDeBoites` (tâche 9) — jamais aucune tuile. */}
              <TuileLogo marque={boite.marque ?? 'email'} />
              <span>
                <b>{boite.identite}</b>
              </span>
              <Interrupteur
                actif={!boiteIdsDesactivees.has(boite.id)}
                libelle={boite.identite}
                disabled={disabled}
                onChange={(actif) => onToggleBoite(boite.id, actif)}
              />
            </div>
          ))
        )}
      </Carte>

      <Carte>
        <div className="jr-formulaire">
          <Champ libelle={libelles.relecture} suffixe={libelles.relectureSuffixe}>
            <input
              type="number"
              min={0}
              value={relecture}
              onChange={(e) => onRelectureChange(e.target.value)}
              disabled={disabled}
            />
          </Champ>
          <div className="jr-aide">{libelles.relectureAide}</div>
        </div>
      </Carte>

      <Carte titre={libelles.recapTitre}>
        <CleValeur libelle={libelles.recapPersona} valeur={recapitulatif.persona} />
        <CleValeur libelle={libelles.recapSources} valeur={recapitulatif.sources} />
        <CleValeur libelle={libelles.recapSequence} valeur={recapitulatif.sequence} />
        <CleValeur libelle={libelles.recapEnvoi} valeur={recapitulatif.envoi} />
        <CleValeur libelle={libelles.recapPremierPassage} valeur={libelles.recapPremierPassageValeur} />
      </Carte>

      {manques.length > 0 && (
        <div className="jr-bandeau erreur" role="alert">
          <span>
            {libelles.erreurLancement} {manques.join(' ; ')}.
          </span>
        </div>
      )}
    </>
  );
}

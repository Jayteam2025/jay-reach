import { BarreProgression } from '../ui';

export interface CarteEnvoisProps {
  libelle: string;
  utilise: number;
  plafond: number;
}

/** Même remarque que `CarteMoteur` : carte à plat, sans `.jr-corps`. */
export function CarteEnvois({ libelle, utilise, plafond }: CarteEnvoisProps) {
  const pourcentage = plafond > 0 ? Math.round((utilise / plafond) * 100) : 0;
  return (
    <div className="jr-carte">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{libelle}</span>
        <b>
          {utilise} / {plafond}
        </b>
      </div>
      <div style={{ margin: '6px 0 2px' }}>
        <BarreProgression valeur={pourcentage} ton={pourcentage >= 100 ? 'erreur' : pourcentage >= 90 ? 'attention' : 'normal'} />
      </div>
    </div>
  );
}

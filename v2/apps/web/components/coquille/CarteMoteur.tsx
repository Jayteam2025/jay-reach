import { Puce } from '../ui';
import type { PuceTon } from '../ui';
import { LigneMoteurLinkedin, type LigneMoteurLinkedinProps } from './LigneMoteurLinkedin';

export interface CarteMoteurProps {
  ton: PuceTon;
  libelleEtat: string;
  detail: string;
  /** `null` ou absent : aucune session LinkedIn n'a jamais existé, pas de ligne. */
  linkedin?: LigneMoteurLinkedinProps | null;
}

/**
 * Carte compacte du pied de barre latérale (`.jr-barre-pied .jr-carte`, sans
 * `.jr-corps` : la maquette la met à plat, contrairement à `Carte` du kit qui
 * enveloppe toujours son contenu — un second niveau de padding ici doublerait
 * celui déjà posé par `.jr-barre-pied .jr-carte`).
 */
export function CarteMoteur({ ton, libelleEtat, detail, linkedin }: CarteMoteurProps) {
  return (
    <div className="jr-carte">
      <Puce ton={ton} point>
        {libelleEtat}
      </Puce>
      <div className="jr-secondaire" style={{ marginTop: 6 }}>
        {detail}
      </div>
      {linkedin && <LigneMoteurLinkedin {...linkedin} />}
    </div>
  );
}

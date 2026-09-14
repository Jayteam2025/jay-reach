import { Puce } from '../ui';
import type { PuceTon } from '../ui';

export interface CarteMoteurProps {
  ton: PuceTon;
  libelleEtat: string;
  detail: string;
}

/**
 * Carte compacte du pied de barre latérale (`.jr-barre-pied .jr-carte`, sans
 * `.jr-corps` : la maquette la met à plat, contrairement à `Carte` du kit qui
 * enveloppe toujours son contenu — un second niveau de padding ici doublerait
 * celui déjà posé par `.jr-barre-pied .jr-carte`).
 */
export function CarteMoteur({ ton, libelleEtat, detail }: CarteMoteurProps) {
  return (
    <div className="jr-carte">
      <Puce ton={ton} point>
        {libelleEtat}
      </Puce>
      <div className="jr-secondaire" style={{ marginTop: 6 }}>
        {detail}
      </div>
    </div>
  );
}

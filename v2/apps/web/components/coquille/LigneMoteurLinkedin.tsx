import { IconeLinkedin } from '../ui/IconeLinkedin';
import type { PuceTon } from '../ui';

export interface LigneMoteurLinkedinProps {
  ton: PuceTon;
  libelle: string;
  detail: string;
}

/**
 * Ligne LinkedIn du bloc « État du moteur » (maquette `maquettes-lot4a.html`, § 2), partagée par
 * le pied de barre latérale et Réglages › Moteur.
 *
 * Le logo garde sa couleur de marque (`.jr-ico-li`) quel que soit l'état : l'état se dit par le
 * libellé, et par sa couleur quand il est en erreur — jamais en grisant ni en recolorant la
 * marque. Aucune « prochaine collecte » : la collecte est à la demande.
 */
export function LigneMoteurLinkedin({ ton, libelle, detail }: LigneMoteurLinkedinProps) {
  return (
    <div className="jr-moteur-linkedin">
      <IconeLinkedin className="jr-ico-li" />
      <span>
        <b className={ton === 'erreur' ? 'jr-texte-erreur' : undefined}>{libelle}</b>
        <small className="jr-secondaire">{detail}</small>
      </span>
    </div>
  );
}

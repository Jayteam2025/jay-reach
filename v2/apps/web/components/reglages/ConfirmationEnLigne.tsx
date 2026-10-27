/**
 * Demande de confirmation posée sous le bouton qui la déclenche : le motif déjà employé par
 * l'archivage d'une campagne (`FormulaireReglagesCampagne`) — un bandeau qui dit ce qui va se
 * passer, puis « Annuler » et le bouton qui confirme. Pas de fenêtre modale : sur ces écrans la
 * confirmation reste à côté du geste, et le bouton d'origine ne part jamais sans elle.
 *
 * Composant sans état : l'appelant tient « confirmation demandée ou non ».
 */
import { Bouton } from '../ui';

export interface ConfirmationEnLigneProps {
  /** Ce que le geste déclenche ou arrête, en une phrase claire. */
  texte: string;
  libelleConfirmer: string;
  libelleAnnuler: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
  /** Le geste est en cours : les deux boutons se figent. */
  pending?: boolean;
  /** Geste qui coupe quelque chose (déconnecter) plutôt qu'il ne lance. */
  danger?: boolean;
}

export function ConfirmationEnLigne({
  texte,
  libelleConfirmer,
  libelleAnnuler,
  onConfirmer,
  onAnnuler,
  pending = false,
  danger = false,
}: ConfirmationEnLigneProps) {
  return (
    <div role="alertdialog" aria-label={texte}>
      <div className="jr-bandeau attention">
        <span>{texte}</span>
      </div>
      <div className="jr-actions">
        <Bouton onClick={onAnnuler} disabled={pending}>
          {libelleAnnuler}
        </Bouton>
        <Bouton
          variante={danger ? 'danger' : 'principal'}
          onClick={onConfirmer}
          disabled={pending}
          aria-busy={pending}
        >
          {libelleConfirmer}
        </Bouton>
      </div>
    </div>
  );
}

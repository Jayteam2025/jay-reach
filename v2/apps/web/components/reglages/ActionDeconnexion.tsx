/**
 * « Déconnecter ce compte » (Réglages › LinkedIn) : le bouton ne déconnecte jamais directement, il
 * demande d'abord de confirmer en disant ce qui s'arrête. Un clic de trop coupe la collecte et les
 * envois LinkedIn de toute l'organisation, et rebrancher un compte demande un mot de passe et,
 * souvent, un code reçu par courriel.
 *
 * Composant sans état (l'appelant tient `demandee`), pour se prouver sous Node sans DOM : même
 * découpage que `CorpsTableTaches`.
 */
import { ConfirmationEnLigne } from './ConfirmationEnLigne';

export interface ActionDeconnexionProps {
  /** La confirmation est ouverte. */
  demandee: boolean;
  /** Clic sur « Déconnecter ce compte » : ouvre la confirmation, ne déconnecte rien. */
  onDemander: () => void;
  /** Clic sur « Annuler » : referme la confirmation. */
  onAnnuler: () => void;
  /** Clic sur « Oui, déconnecter » : la seule voie qui déconnecte. */
  onConfirmer: () => void;
  pending: boolean;
  libelles: {
    deconnecter: string;
    confirmation: string;
    confirmer: string;
    annuler: string;
  };
}

export function ActionDeconnexion({ demandee, onDemander, onAnnuler, onConfirmer, pending, libelles }: ActionDeconnexionProps) {
  if (demandee) {
    return (
      <ConfirmationEnLigne
        texte={libelles.confirmation}
        libelleConfirmer={libelles.confirmer}
        libelleAnnuler={libelles.annuler}
        onConfirmer={onConfirmer}
        onAnnuler={onAnnuler}
        pending={pending}
        danger
      />
    );
  }
  return (
    <div className="jr-session-boutons">
      <button type="button" className="jr-bouton" onClick={onDemander} disabled={pending}>
        {libelles.deconnecter}
      </button>
    </div>
  );
}

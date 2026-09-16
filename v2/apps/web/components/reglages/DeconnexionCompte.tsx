/**
 * Carte « Session » de Réglages › Compte (R89, ajout au tour de correction 1) :
 * seul écran du dépôt qui permette de se déconnecter jusqu'ici. Serveur pur
 * (aucun hook). `action` reçoit `signOut` (`app/actions/auth.ts`, déjà
 * existante, jamais appelée nulle part avant ce commit) depuis la page — pas
 * d'import direct d'une fonction `'use server'` ici, pour rester testable par
 * `renderToStaticMarkup` avec une fonction factice (même prudence que
 * `FormulaireReglagesCampagne`/`TiroirRelecture` vis-à-vis de `useRouter`).
 */
import { Bouton, Carte } from '../ui';

export interface DeconnexionCompteLibelles {
  titre: string;
  bouton: string;
}

export interface DeconnexionCompteProps {
  /** Action serveur du formulaire — `signOut` en production, un simple espion dans les tests. */
  action: (formData: FormData) => void | Promise<void>;
  libelles: DeconnexionCompteLibelles;
}

export function DeconnexionCompte({ action, libelles }: DeconnexionCompteProps) {
  return (
    <Carte titre={libelles.titre}>
      <form action={action}>
        <Bouton type="submit">{libelles.bouton}</Bouton>
      </form>
    </Carte>
  );
}

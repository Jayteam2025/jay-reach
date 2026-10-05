import { SqueletteFicheCampagne } from '../../squelette';

/**
 * Fiche de campagne et ses six sous-pages (contacts, file, activité, séquence,
 * sources, réglages) : toutes partagent l'en-tête, la barre d'onglets et la
 * grille `.jr-contenu`, donc le même squelette.
 */
export default function Chargement() {
  return <SqueletteFicheCampagne />;
}

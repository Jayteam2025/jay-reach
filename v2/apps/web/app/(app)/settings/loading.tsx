import { SqueletteListe } from '../squelette';

/**
 * Réglages : Compte, Moteur, Plafonds, Messages et Fournisseurs sont des suites
 * de cartes. Sans ce fichier ils héritaient du squelette de l'accueil, dont la
 * grille à trois colonnes n'a rien à voir avec la leur. Expéditeurs et personas
 * gardent le leur, plus proche de leur contenu.
 */
export default function Chargement() {
  return <SqueletteListe cartes={3} />;
}

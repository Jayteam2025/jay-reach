import { SqueletteListe } from '../../squelette';

/** Listes de clients à exclure, une carte chacune. */
export default function Chargement() {
  return <SqueletteListe active="customers" cartes={3} entete />;
}

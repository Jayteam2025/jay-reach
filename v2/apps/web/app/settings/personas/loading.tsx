import { SqueletteListe } from '../../squelette';

/** Un persona par carte, avec le bouton d'ajout en tête. */
export default function Chargement() {
  return <SqueletteListe active="personas" cartes={3} entete />;
}

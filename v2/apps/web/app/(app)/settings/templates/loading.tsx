import { SqueletteListe } from '../../squelette';

/** Un modèle par carte, avec le bouton d'ajout en tête. */
export default function Chargement() {
  return <SqueletteListe active="templates" cartes={3} entete />;
}

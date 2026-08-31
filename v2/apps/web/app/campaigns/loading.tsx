import { SqueletteEcran } from '../squelette';

/** Liste des campagnes, une carte chacune. */
export default function Chargement() {
  return <SqueletteEcran active="campaigns" cartes={3} />;
}
